import json
import jsonschema
from jsonschema import validate
import os

search_dir = os.getcwd()

schema_file = "auth-schema.json"

# validate JSON func
def validate_json(file_path):
    with open(file_path, "r") as json_file:
        json_data = json.load(json_file)
    with open(schema_file, "r") as schema:
        schema_data = json.load(schema)
    try:
        validate(instance=json_data, schema=schema_data)
        print(f"{file_path} is valid")
    except jsonschema.exceptions.ValidationError as e:
        print(f"{file_path} is invalid")
        print(f"Validation Error: {e.message}")

# finds any file named auth.json
for root, dirs, files in os.walk(search_dir):
    for file in files:
        if file == "auth.json":
            file_path = os.path.join(root, file)
            validate_json(file_path)