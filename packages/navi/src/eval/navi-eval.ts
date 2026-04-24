import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Log } from '@/util/log';
import { UI } from '../cli/ui';
import { SessionPrompt } from '../session/prompt';
import { SessionID, MessageID } from '../session/schema';
import { ProviderID, ModelID } from '../provider/schema';
import { Identifier } from '@/id/id';
import { Provider } from '../provider/provider';


/**
 * Navi-Eval: Iterative Learning System for Navi.
 * Ported from Codebuff's evalbuff logic.
 */

const log = Log.create({ service: 'navi-eval' });

export interface EvalTask {
  sha: string;
  parentSha: string;
  message: string;
  prompt: string;
  diff: string;
  filesChanged: string[];
}

export interface EvalState {
  lastProcessedCommitSha: string | null;
  totalCostUsd: number;
  processedCommitCount: number;
}

export class NaviEval {
  private repoPath: string;
  private statePath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.statePath = path.join(repoPath, '.navi', 'eval-state.json');
  }

  /**
   * Loads the current evaluation state.
   */
  private loadState(): EvalState {
    if (fs.existsSync(this.statePath)) {
      try {
        return JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
      } catch (e) {
        log.error(`Failed to load eval state: ${e}`);
      }
    }
    return {
      lastProcessedCommitSha: null,
      totalCostUsd: 0,
      processedCommitCount: 0,
    };
  }

  /**
   * Saves the current evaluation state.
   */
  private saveState(state: EvalState) {
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Gets a list of commits to learn from.
   */
  public getCommitList(count: number, startAfterSha?: string): string[] {
    try {
      if (startAfterSha) {
        const output = execSync(
          `git log --format=%H --reverse ${startAfterSha}..HEAD`,
          { cwd: this.repoPath, encoding: 'utf-8' }
        ).trim();
        return output ? output.split('\n') : [];
      }
      const output = execSync(
        `git log --format=%H -n ${count} --reverse`,
        { cwd: this.repoPath, encoding: 'utf-8' }
      ).trim();
      return output ? output.split('\n') : [];
    } catch (e) {
      log.error(`Failed to get commit list: ${e}`);
      return [];
    }
  }

  /**
   * Generates an EvalTask from a single commit.
   */
  public async buildTask(sha: string): Promise<EvalTask | null> {
    try {
      const parents = execSync(`git log --pretty=%P -n 1 ${sha}`, {
        cwd: this.repoPath,
        encoding: 'utf-8',
      }).trim();

      if (!parents || parents.split(' ').length > 1) return null; // Skip initial/merge
      const parentSha = parents.split(' ')[0];

      const message = execSync(`git log --format=%B -n 1 ${sha}`, {
        cwd: this.repoPath,
        encoding: 'utf-8',
      }).trim();

      const diff = execSync(`git diff ${parentSha} ${sha}`, {
        cwd: this.repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      const filesOutput = execSync(`git diff --name-only ${parentSha} ${sha}`, {
        cwd: this.repoPath,
        encoding: 'utf-8',
      }).trim();
      const filesChanged = filesOutput ? filesOutput.split('\n') : [];

      if (filesChanged.length === 0 || diff.length > 100000) return null;

      const prompt = await this.generatePrompt(message, diff);

      return { sha, parentSha, message, prompt, diff, filesChanged };
    } catch (e) {
      log.error(`Failed to build task: ${e}`);
      return null;
    }
  }

  /**
   * Generates a realistic human-like prompt from a commit diff.
   */
  private async generatePrompt(message: string, diff: string): Promise<string> {
    const generatorPrompt = `
You are generating a natural language task prompt for an AI assistant.
Given the following git commit message and diff, write a 1-2 sentence prompt that a developer might use to request this change.
Focus on WHAT was achieved, not HOW (e.g., "Add user registration" instead of "Create the register endpoint").

COMMIT MESSAGE:
${message}

DIFF:
${diff.slice(0, 5000)}
    `.trim();

    try {
      const response = await SessionPrompt.prompt({
        sessionID: SessionID.make(Identifier.ascending('session')),
        messageID: MessageID.ascending(),
        model: await Provider.defaultModel(),
        agent: 'general',
        parts: [{ type: "text", text: generatorPrompt }]
      });

      const textPart = response.parts.find(p => p.type === 'text');
      if (textPart && 'text' in textPart) {
        return textPart.text;
      }
    } catch (e) {
      log.error(`Failed to generate prompt: ${e}`);
    }

    return message; 
  }

  /**
   * Runs the learning loop over git commits.
   */
  public async runLearnMode(count: number = 10) {
    const state = this.loadState();
    const commits = this.getCommitList(count, state.lastProcessedCommitSha || undefined);

    for (const sha of commits) {
      UI.println(`${UI.Style.TEXT_INFO_BOLD} ● ${UI.Style.TEXT_NORMAL} Processing: ${UI.Style.TEXT_HIGHLIGHT}${sha.slice(0, 8)}${UI.Style.TEXT_NORMAL}`);
      const task = await this.buildTask(sha);
      if (!task) {
          UI.println(`   ${UI.Style.TEXT_DIM} (Skipping: invalid commit/merge)`);
          continue;
      }

      UI.println(`   ${UI.Style.TEXT_DIM} Prompt: "${UI.Style.TEXT_NORMAL}${task.prompt}${UI.Style.TEXT_DIM}"`);
      
      // 1. Reset repo to parent state
      try {
        execSync(`git reset --hard ${task.parentSha}`, { cwd: this.repoPath, stdio: 'ignore' });
        execSync(`git clean -fd`, { cwd: this.repoPath, stdio: 'ignore' });
      } catch (e) {
        log.error(`Failed to reset repo to ${task.parentSha}: ${e}`);
        continue;
      }
      
      // 2. Run agent execution loop
      let agentDiff = "";
      try {
        const sessionID = SessionID.make(Identifier.ascending('session'));
        await SessionPrompt.prompt({
          sessionID,
          messageID: MessageID.ascending(),
          model: await Provider.defaultModel(),
          agent: 'build',
          parts: [{ type: "text", text: task.prompt }]
        });

        // Let the agent finish its task
        await SessionPrompt.loop({ sessionID });

        // 3. Capture the resulting diff
        agentDiff = execSync(`git diff`, { 
          cwd: this.repoPath, 
          encoding: 'utf-8', 
          maxBuffer: 10 * 1024 * 1024 
        });
      } catch (e) {
        log.error(`Agent execution failed for commit ${sha}: ${e}`);
      }
      
      // 4. Compare and Analyze
      if (agentDiff.trim() !== task.diff.trim()) {
        UI.println(`   ${UI.Style.TEXT_WARNING} ✗ Mismatch found. Analyzing for conventions...`);
        await this.analyzeAndProposeConventions(task, agentDiff);
      } else {
        UI.println(`   ${UI.Style.TEXT_SUCCESS} ✓ Ground truth matched perfectly!`);
      }
      
      state.lastProcessedCommitSha = sha;
      state.processedCommitCount++;
      this.saveState(state);
      UI.empty();
    }
  }


  /**
   * Analyzes a failure and proposes a generic convention document.
   */
  private async analyzeAndProposeConventions(task: EvalTask, agentDiff: string) {
    const analysisPrompt = `
You are the Navi Conventions Optimizer. An AI agent failed to replicate a real git commit.
Your job is to identify a GENERIC pattern or convention that would have helped the agent succeed.

TASK PROMPT:
${task.prompt}

GROUND TRUTH DIFF (The correct change):
${task.diff}

AGENT DIFF (What the agent did wrong):
${agentDiff || '(No changes made)'}

INSTRUCTIONS:
1. Identify the root cause of the mismatch.
2. Propose a generic convention (e.g., "Use Result types for all API responses in this project").
3. Write it in markdown format for a file named \`.navi/conventions/new-convention.md\`.

Respond with ONLY the markdown content.
    `.trim();

    try {
      const response = await SessionPrompt.prompt({
        sessionID: SessionID.make(Identifier.ascending('session')),
        messageID: MessageID.ascending(),
        model: await Provider.defaultModel(),
        agent: 'general',
        parts: [{ type: "text", text: analysisPrompt }]
      });

      const textPart = response.parts.find(p => p.type === 'text');
      if (textPart && 'text' in textPart) {
        const conventionMarkdown = textPart.text;
        const conventionDir = path.join(this.repoPath, '.navi', 'conventions');
        if (!fs.existsSync(conventionDir)) fs.mkdirSync(conventionDir, { recursive: true });
        
        const timestamp = Date.now();
        const filename = `convention-${timestamp}.md`;
        fs.writeFileSync(path.join(conventionDir, filename), conventionMarkdown);
        UI.println(`   ${UI.Style.TEXT_SUCCESS} ⚡ Proposed convention saved to ${UI.Style.TEXT_HIGHLIGHT}.navi/conventions/${filename}${UI.Style.TEXT_NORMAL}`);
      }
    } catch (e) {
      log.error(`Failed to analyze failure: ${e}`);
    }
  }
}



