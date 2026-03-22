import json

with open('v:/pankaj/navi/script/models/models_dev.json', 'r') as f:
    data = json.load(f)

result = {}
providers_to_check = ['opencode', 'zenmux', 'firmware', 'zai-coding-plan']

for pid in providers_to_check:
    if pid in data:
        provider = data[pid]
        free_models = {}
        for mid, model in provider['models'].items():
            if model.get('cost', {}).get('input') == 0 and model.get('cost', {}).get('output') == 0:
                free_models[mid] = model
        
        if free_models:
            result[pid] = {
                'id': provider['id'],
                'name': provider['name'],
                'api': provider.get('api'),
                'env': provider.get('env', []),
                'npm': provider.get('npm'),
                'models': free_models
            }

print(json.dumps(result, indent=4))
