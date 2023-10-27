import json
import jsonschema
import os
import sys

search_dir = os.path.join(os.getcwd())
schema_file = "auth-schema.json"

# Validation function
def validate_json(file_path, schema_data):
    with open(file_path, "r") as json_file:
        json_data = json.load(json_file)

    validator = jsonschema.Draft7Validator(schema_data)

    relative_file_path = os.path.relpath(file_path, search_dir)
    validation_errors = {}

    for error in validator.iter_errors(json_data):
        error_msg = error.message
        error_path = list(error.absolute_path)
        error_section = error_path[1] if len(error_path) > 1 else None

        if error_section:
            if error_section not in validation_errors:
                validation_errors[error_section] = []
            validation_errors[error_section].append(f"• {error_msg}")
        else:
            if "global" not in validation_errors:
                validation_errors["global"] = []
            validation_errors["global"].append(f"• {error_msg}")

    if not validation_errors:
        print(f"\x1b[32m{relative_file_path} is valid\x1b[0m")
    else:
        print(f"\x1b[31m{relative_file_path} is invalid")
        for section, errors in validation_errors.items():
            print(f"    ↳ {section}:")
            for error in errors:
                print(f"        {error}")

    return not bool(validation_errors)

with open(schema_file, "r") as schema:
    schema_data = json.load(schema)

all_files_valid = True

# find auth.json files
for root, dirs, files in os.walk(search_dir):
    if root != search_dir:
        for file in files:
            if file == "auth.json":
                file_path = os.path.join(root, file)
                is_file_valid = validate_json(file_path, schema_data)
                if not is_file_valid:
                    all_files_valid = False

if not all_files_valid:
    sys.exit(1)
