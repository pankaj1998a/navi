"""Extract free models from the provider model catalog.

Usage:
    python extract_free_models.py [path/to/models_dev.json]

If no path is given, looks for models_dev.json next to this script.
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_INPUT = os.path.join(SCRIPT_DIR, "models_dev.json")


def extract_free_models(input_path: str) -> None:
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found.")
        sys.exit(1)

    with open(input_path, "r") as f:
        data = json.load(f)

    result = {}
    providers_to_check = ["opencode", "zenmux", "firmware", "zai-coding-plan"]

    for pid in providers_to_check:
        if pid in data:
            provider = data[pid]
            free_models = {}
            for mid, model in provider["models"].items():
                if (
                    model.get("cost", {}).get("input") == 0
                    and model.get("cost", {}).get("output") == 0
                ):
                    free_models[mid] = model

            if free_models:
                result[pid] = {
                    "id": provider["id"],
                    "name": provider["name"],
                    "api": provider.get("api"),
                    "env": provider.get("env", []),
                    "npm": provider.get("npm"),
                    "models": free_models,
                }

    print(json.dumps(result, indent=4))


if __name__ == "__main__":
    input_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_INPUT
    extract_free_models(input_path)
