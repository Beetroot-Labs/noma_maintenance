#!/bin/bash

set -e

# Function to display help message
show_help() {
    echo "Usage: $0 [-h|--help] [-d <dir>] [positional_arg]"
    echo ""
    echo "Options:"
    echo "  -h, --help      Show this help message and exit"
    echo "  -d <dir>        Use an alternate directory name under the builds directory as DB_DIR"
    echo ""
    echo "Positional Arguments:"
    echo "  positional_arg  An optional positional argument (default: \$SCRIPT_DIR/contents/dev_clean.sql)"
}

# Get the directory of the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

. $SCRIPT_DIR/setup_global_variables.sh

# Default values
DB_DIR_NAME="dev_database"

# Default positional argument
CONTENT_FILE="$SCRIPT_DIR/contents/dev_clean.sql"

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -d)
            if [[ -n $2 ]]; then
                DB_DIR_NAME="$2"
                shift
            else
                echo "Error: -d option requires an argument."
                show_help
                exit 1
            fi
            ;;
        *)
            CONTENT_FILE="$1"
            ;;
    esac
    shift
done



# Calculate the builds directory
BUILDS_DIR="$PROJECT_ROOT/builds"

# Define the target directory
DB_DIR="$BUILDS_DIR/$DB_DIR_NAME"

echo "Versioned schema file: $VERSIONED_SCHEMA_FILE"

# Check if a PostgreSQL instance is running and stop it if necessary
if /usr/lib/postgresql/$PVER/bin/pg_ctl -D "$DB_DIR" status > /dev/null 2>&1; then
    echo "PostgreSQL instance is running. Stopping it..."
    /usr/lib/postgresql/$PVER/bin/pg_ctl -D "$DB_DIR" stop
fi

# Check if the directory exists
if [ -d "$DB_DIR" ]; then
    echo "Directory '$DB_DIR' exists."
    read -p "Do you want to erase it? (yes/no): " RESPONSE
    case "$RESPONSE" in
        [Yy][Ee][Ss]|[Yy])
            rm -rf "$DB_DIR"
            echo "Directory erased."
            ;;
        *)
            echo "Directory not erased. Exiting script."
            exit 1
            ;;
    esac
fi

echo "Database directory: $DB_DIR"
echo "Creating storage"
/usr/lib/postgresql/$PVER/bin/pg_ctl init -D "$DB_DIR"

echo "Creating licensing db"
/usr/lib/postgresql/$PVER/bin/pg_ctl -D "$DB_DIR" -o "-k $BUILDS_DIR" start
/usr/lib/postgresql/$PVER/bin/createdb -h "$BUILDS_DIR" -p 5432 licenses

psql -h "$BUILDS_DIR" -p 5432 -f "$VERSIONED_SCHEMA_FILE" licenses
psql -h "$BUILDS_DIR" -p 5432 -f "$UPDATE_SCHEMA_FILE" licenses

echo "Initializing with content: $CONTENT_FILE"
psql -h "$BUILDS_DIR" -p 5432 -f "$CONTENT_FILE" licenses

/usr/lib/postgresql/$PVER/bin/pg_ctl -D "$DB_DIR" stop
echo "Database initialized. You can start with start_db.sh"
