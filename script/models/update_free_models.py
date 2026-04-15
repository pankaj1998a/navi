"""Update the free-models.json provider catalog from extracted data.

Usage:
    python update_free_models.py [path/to/free_models_extracted.json]

If no path is given, looks for free_models_extracted.json next to this script.
The target free-models.json is resolved relative to the project root
(two directories up from this script).
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.join(SCRIPT_DIR, "..", "..")

DEFAULT_INPUT = os.path.join(SCRIPT_DIR, "free_models_extracted.json")
DEFAULT_TARGET = os.path.join(
    PROJECT_ROOT, "packages", "navi", "src", "provider", "free-models.json"
)


def update_models(input_path: str, target_path: str) -> None:
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found.")
        sys.exit(1)

    with open(input_path, "r") as f:
        extracted_data = json.load(f)

    if os.path.exists(target_path):
        with open(target_path, "r") as f:
            target_data = json.load(f)
    else:
        target_data = {}

    # Default headers for Navi
    default_headers = {
        "HTTP-Referer": "https://navi.ai/",
        "X-Title": "navi",
    }

    for provider_id, provider_info in extracted_data.items():
        if provider_id not in target_data:
            target_data[provider_id] = {
                "id": provider_info["id"],
                "name": provider_info["name"],
                "api": provider_info["api"],
                "env": provider_info["env"],
                "npm": provider_info["npm"],
                "models": {},
            }

        for model_id, model_info in provider_info["models"].items():
            # Prepare model entry
            model_entry = {
                "id": model_info["id"],
                "name": model_info["name"],
                "attachment": model_info.get("attachment", False),
                "reasoning": model_info.get("reasoning", False),
                "temperature": model_info.get("temperature", True),
                "tool_call": model_info.get("tool_call", True),
                "cost": model_info.get("cost", {"input": 0, "output": 0}),
                "limit": model_info.get("limit", {"context": 128000, "output": 8192}),
                "options": {},
                "headers": default_headers.copy(),
            }

            # If model already exists in target, preserve its options/headers
            if model_id in target_data[provider_id]["models"]:
                existing_model = target_data[provider_id]["models"][model_id]
                model_entry["options"] = existing_model.get("options", {})
                model_entry["headers"] = existing_model.get(
                    "headers", default_headers.copy()
                )

            target_data[provider_id]["models"][model_id] = model_entry

    # Ensure target directory exists
    os.makedirs(os.path.dirname(target_path), exist_ok=True)

    with open(target_path, "w") as f:
        json.dump(target_data, f, indent=4)

    print(f"Successfully updated {target_path}")


if __name__ == "__main__":
    input_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_INPUT
    update_models(input_path, DEFAULT_TARGET)
