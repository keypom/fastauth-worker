#!/opt/homebrew/bin/bash

echo "Using Bash version: $BASH_VERSION"

# Exit immediately if a command exits with a non-zero status.
set -e

# Function to display usage information
usage() {
  echo "Usage: $0 [development|production|local]"
  exit 1
}

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
  echo "wrangler is required but not installed. Please install wrangler and try again."
  exit 1
fi

# Get the environment from the first argument
ENVIRONMENT=$1

# Validate the environment argument
if [[ -z "$ENVIRONMENT" ]]; then
  echo "Error: No environment specified."
  usage
fi

if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "production" && "$ENVIRONMENT" != "local" ]]; then
  echo "Error: Invalid environment '$ENVIRONMENT'."
  usage
fi

# Define environment directories and files
ENV_DIR="env/$ENVIRONMENT"
PUBLIC_VARS_FILE="$ENV_DIR/.${ENVIRONMENT}.public.vars"
SECRET_VARS_FILE="$ENV_DIR/.${ENVIRONMENT}.secret.vars"
ENV_FILE=".env.$ENVIRONMENT"

# Function to load variables from a file into an associative array
load_vars() {
  local file_path=$1
  declare -n vars=$2
  while IFS='=' read -r key value; do
    # Skip empty lines and comments
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    vars["$key"]="$value"
  done < "$file_path"
}

# Function to create an .env file from public variables
create_env_file() {
  local env=$1
  declare -A public_vars=()

  echo "Creating .env file for environment: $env"

  # Load public variables
  load_vars "$PUBLIC_VARS_FILE" public_vars

  # Write variables to the .env file
  {
    for key in "${!public_vars[@]}"; do
      echo "$key=${public_vars[$key]}"
    done
  } > "$ENV_FILE"

  echo ".env file created: $ENV_FILE"
}

# Function to set secrets using wrangler
set_secrets() {
  local env=$1
  declare -n secrets=$2

  echo "Setting secrets for environment: $env"

  for key in "${!secrets[@]}"; do
    cleaned_value=$(echo "${secrets[$key]}" | sed 's/^["'\'']//;s/["'\'']$//' | tr -d '\n')
    echo "Setting secret '$key' with value length: ${#cleaned_value}"
    echo "$cleaned_value" | wrangler secret put "$key" --env "$env"
  done

  echo "Secrets set successfully for environment: $env"
}

# Handle 'local' environment
if [[ "$ENVIRONMENT" == "local" ]]; then
  # Check if public and secret vars exist
  if [[ ! -f "$PUBLIC_VARS_FILE" || ! -f "$SECRET_VARS_FILE" ]]; then
    echo "Error: Public or secret variables file not found for 'local' environment."
    exit 1
  fi

  # Combine public and secret variables into .dev.vars
  update_dev_vars() {
    local combined_vars=".dev.vars"
    echo "Combining public and secret variables into $combined_vars"
    cat "$PUBLIC_VARS_FILE" "$SECRET_VARS_FILE" > "$combined_vars"
    echo "$combined_vars created successfully"
  }

  update_dev_vars

  # Run the worker locally
  echo "Running worker locally with environment: $ENVIRONMENT"
  wrangler dev --env "$ENVIRONMENT" --port 8787
  exit 0
fi

# For 'dev' and 'production' environments
if [[ ! -f "$PUBLIC_VARS_FILE" ]]; then
  echo "Error: Public variables file '$PUBLIC_VARS_FILE' not found!"
  exit 1
fi

if [[ ! -f "$SECRET_VARS_FILE" ]]; then
  echo "Error: Secret variables file '$SECRET_VARS_FILE' not found!"
  exit 1
fi

# Create an .env file with public variables
create_env_file "$ENVIRONMENT"

# Load secret variables
declare -A SECRET_VARS
load_vars "$SECRET_VARS_FILE" SECRET_VARS

# Set secrets using wrangler
set_secrets "$ENVIRONMENT" SECRET_VARS

# Deploy the worker using the .env file
echo "Deploying worker to Cloudflare network with public and secret variables for environment: $ENVIRONMENT"
wrangler publish --env "$ENVIRONMENT"

echo "Deployment to '$ENVIRONMENT' environment completed successfully."
