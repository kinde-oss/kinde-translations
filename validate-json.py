import json
import jsonschema
import os

search_dir = os.getcwd()
schema_file = "auth-schema.json"

# Validcation func
def validate_json(file_path, schema_data):
    with open(file_path, "r") as json_file:
        json_data = json.load(json_file)

    validator = jsonschema.Draft7Validator(schema_data)

    validation_errors = []

    relative_file_path = os.path.relpath(file_path, search_dir)

    for error in validator.iter_errors(json_data):
        validation_errors.append(error.message)

    if not validation_errors:
        print(f"\x1b[32m{file_path} is valid\x1b[0m")
    else:
        print(f"\x1b[31m{file_path} is invalid")
        for error in validation_errors:
            indented_error = (" " * 4) + "• "
            print(f"\x1b[31m{indented_error}Error on {relative_file_path}: {error}\x1b[0m")

# Load schema
with open(schema_file, "r") as schema:
    schema_data = json.load(schema)

# Find auth.json files
for root, dirs, files in os.walk(search_dir):
    for file in files:
        if file == "auth.json":
            file_path = os.path.join(root, file)
            validate_json(file_path, schema_data)
