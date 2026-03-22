import json
import os

# Paths
EXTRACTED_FILE = 'v:/pankaj/navi/script/models/free_models_extracted.json'
TARGET_FILE = 'v:/pankaj/navi/packages/navi/src/provider/free-models.json'

def update_models():
    if not os.path.exists(EXTRACTED_FILE):
        print(f"Error: {EXTRACTED_FILE} not found.")
        return

    with open(EXTRACTED_FILE, 'r') as f:
        extracted_data = json.load(f)

    if os.path.exists(TARGET_FILE):
        with open(TARGET_FILE, 'r') as f:
            target_data = json.load(f)
    else:
        target_data = {}

    # Default headers for Navi
    default_headers = {
        "HTTP-Referer": "https://navi.ai/",
        "X-Title": "navi"
    }

    for provider_id, provider_info in extracted_data.items():
        if provider_id not in target_data:
            target_data[provider_id] = {
                "id": provider_info["id"],
                "name": provider_info["name"],
                "api": provider_info["api"],
                "env": provider_info["env"],
                "npm": provider_info["npm"],
                "models": {}
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
                "headers": default_headers.copy()
            }
            
            # If model already exists in target, preserve its options/headers if they exist
            if model_id in target_data[provider_id]["models"]:
                existing_model = target_data[provider_id]["models"][model_id]
                model_entry["options"] = existing_model.get("options", {})
                model_entry["headers"] = existing_model.get("headers", default_headers.copy())
            
            target_data[provider_id]["models"][model_id] = model_entry

    with open(TARGET_FILE, 'w') as f:
        json.dump(target_data, f, indent=4)
    
    print(f"Successfully updated {TARGET_FILE}")

if __name__ == "__main__":
    update_models()
