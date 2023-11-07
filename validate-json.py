import json
import jsonschema
import os
import sys

# Validation function


def validate_json(file_path, schema_data):
    try:
        with open(file_path, 'r') as json_file:
            json_data = json.load(json_file)

        validator = jsonschema.Draft7Validator(schema_data)
        errors = sorted(validator.iter_errors(json_data), key=lambda e: e.path)

        if errors:
            print(f"\x1b[31m{file_path} is invalid")
            for error in errors:
                error_path = list(error.path)
                error_section = error_path[0] if error_path else 'global'
                print(f"    ↳ {error_section}: {error.message}")
            return False
        else:
            print(f"\x1b[32m{file_path} is valid\x1b[0m")
            return True
    except jsonschema.exceptions.ValidationError as ve:
        print(f"{file_path} is invalid: {ve}")
        return False
    except Exception as e:
        print(f"An error occurred with {file_path}: {e}")
        return False


def main(schema_file, files_to_check):
    # Load the schema data once
    with open(schema_file, 'r') as schema:
        schema_data = json.load(schema)

    all_files_valid = True

    # If files_to_check is empty, find auth.json files in the directory
    if not files_to_check:
        search_dir = os.path.join(os.getcwd())
        for root, dirs, files in os.walk(search_dir):
            for file in files:
                if file.endswith("auth.json"):
                    file_path = os.path.join(root, file)
                    if not validate_json(file_path, schema_data):
                        all_files_valid = False
    else:
        # Validate each file passed in files_to_check
        for file_path in files_to_check:
            if not validate_json(file_path, schema_data):
                all_files_valid = False

    return all_files_valid


if __name__ == "__main__":
    # If no arguments are passed, walk the directory structure
    if len(sys.argv) == 1:
        if not main("auth-schema.json", []):
            sys.exit(1)
    else:
        schema_file_arg = sys.argv[1]
        files_to_validate = sys.argv[2:]

        if not main(schema_file_arg, files_to_validate):
            sys.exit(1)
