import json
import jsonschema
from jsonschema import validate
import os

search_dir = os.getcwd()
schema_file = "auth-schema.json"

# JSON validation func
def validate_json(file_path):
    with open(file_path, "r") as json_file:
        json_data = json.load(json_file)
    with open(schema_file, "r") as schema:
        schema_data = json.load(schema)
    try:
        validate(instance=json_data, schema=schema_data)
        print(f"\x1b[32m{file_path} valid\x1b[0m")
    except jsonschema.exceptions.ValidationError as e:
        print(f"\x1b[31m{file_path} invalid")
        print(f"Validation Error: {e.message}\x1b[0m")

# find auth.json files
for root, dirs, files in os.walk(search_dir):
    for file in files:
        if file == "auth.json":
            file_path = os.path.join(root, file)
            validate_json(file_path)