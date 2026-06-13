CREATE TABLE `navi_history_fts` (
	`part_id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`tool_name` text,
	`body` text NOT NULL,
	`time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `navi_memory_fts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`path` text NOT NULL UNIQUE,
	`scope` text NOT NULL,
	`scope_id` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`body` text NOT NULL,
	`fingerprint` text NOT NULL,
	`last_indexed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `navi_history_fts_session_idx` ON `navi_history_fts` (`session_id`,`time_created`);--> statement-breakpoint
CREATE INDEX `navi_history_fts_project_idx` ON `navi_history_fts` (`project_id`,`time_created`);--> statement-breakpoint
CREATE INDEX `navi_history_fts_message_idx` ON `navi_history_fts` (`message_id`);--> statement-breakpoint
CREATE INDEX `navi_memory_fts_scope_idx` ON `navi_memory_fts` (`scope`,`scope_id`);--> statement-breakpoint
CREATE INDEX `navi_memory_fts_type_idx` ON `navi_memory_fts` (`type`);--> statement-breakpoint
CREATE VIRTUAL TABLE `navi_memory_fts_idx` USING fts5(
  body,
  content='navi_memory_fts',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1'
);--> statement-breakpoint
CREATE TRIGGER `navi_memory_fts_ai` AFTER INSERT ON `navi_memory_fts` BEGIN
  INSERT INTO `navi_memory_fts_idx`(rowid, body) VALUES (NEW.id, NEW.body);
END;--> statement-breakpoint
CREATE TRIGGER `navi_memory_fts_ad` AFTER DELETE ON `navi_memory_fts` BEGIN
  INSERT INTO `navi_memory_fts_idx`(`navi_memory_fts_idx`, rowid, body) VALUES('delete', OLD.id, OLD.body);
END;--> statement-breakpoint
CREATE TRIGGER `navi_memory_fts_au` AFTER UPDATE ON `navi_memory_fts` BEGIN
  INSERT INTO `navi_memory_fts_idx`(`navi_memory_fts_idx`, rowid, body) VALUES('delete', OLD.id, OLD.body);
  INSERT INTO `navi_memory_fts_idx`(rowid, body) VALUES (NEW.id, NEW.body);
END;--> statement-breakpoint
CREATE VIRTUAL TABLE `navi_history_fts_idx` USING fts5(
  body,
  content='navi_history_fts',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 1'
);--> statement-breakpoint
CREATE TRIGGER `navi_history_fts_ai` AFTER INSERT ON `navi_history_fts` BEGIN
  INSERT INTO `navi_history_fts_idx`(rowid, body) VALUES (NEW.rowid, NEW.body);
END;--> statement-breakpoint
CREATE TRIGGER `navi_history_fts_ad` AFTER DELETE ON `navi_history_fts` BEGIN
  INSERT INTO `navi_history_fts_idx`(`navi_history_fts_idx`, rowid, body) VALUES('delete', OLD.rowid, OLD.body);
END;--> statement-breakpoint
CREATE TRIGGER `navi_history_fts_au` AFTER UPDATE ON `navi_history_fts` BEGIN
  INSERT INTO `navi_history_fts_idx`(`navi_history_fts_idx`, rowid, body) VALUES('delete', OLD.rowid, OLD.body);
  INSERT INTO `navi_history_fts_idx`(rowid, body) VALUES (NEW.rowid, NEW.body);
END;