#!/bin/bash

# Check if an environment argument is provided
if [ -z "$1" ]; then
  echo "Usage: $0 [dev|prod]"
  exit 1
fi

ENVIRONMENT=$1

# Load the appropriate environment variables
if [ "$ENVIRONMENT" == "dev" ]; then
  ENV_FILE=".dev.vars"
elif [ "$ENVIRONMENT" == "production" ]; then
  ENV_FILE=".prod.vars"
else
  echo "Invalid environment specified. Use 'dev' or 'prod'."
  exit 1
fi

# Load environment variables
if [ -f "$ENV_FILE" ]; then
  source "$ENV_FILE"
else
  echo "Environment file '$ENV_FILE' not found!"
  exit 1
fi

# Check if required environment variables are set
if [ -z "$AIRTABLE_AGENDA_ALERTS_BASE_ID" ] || [ -z "$AIRTABLE_PERSONAL_ACCESS_TOKEN" ]; then
  echo "Required environment variables are not set in '$ENV_FILE'."
  exit 1
fi

echo "Checking status of webhooks for environment: $ENVIRONMENT"
echo "----------------------------------------"

# Function to check the status of a webhook
check_webhook_status() {
  local webhook_id=$1
  local webhook_name=$2

  RESPONSE=$(curl -s -X GET "https://api.airtable.com/v0/bases/$AIRTABLE_AGENDA_ALERTS_BASE_ID/webhooks" \
    -H "Authorization: Bearer $AIRTABLE_PERSONAL_ACCESS_TOKEN" \
    -H "Content-Type: application/json")

  # Uncomment the following lines if you want to see the raw response
  # echo "Raw Response:"
  # echo "$RESPONSE"
  # echo "----------------------------------------"

  if echo "$RESPONSE" | jq . >/dev/null 2>&1; then
    # The response is valid JSON
    if echo "$RESPONSE" | jq -e '.error' >/dev/null 2>&1; then
      # An error is present in the response
      error_message=$(echo "$RESPONSE" | jq -r '.error.message')
      printf "$webhook_name Webhook ID: $webhook_id - Status: \e[31mError\e[0m\n"
      echo "Error Details: $error_message"
    else
      # Search for the webhook with the given ID
      webhook=$(echo "$RESPONSE" | jq --arg id "$webhook_id" '.webhooks[] | select(.id == $id)')
      if [ -z "$webhook" ]; then
        printf "$webhook_name Webhook ID: $webhook_id - Status: \e[31mNot Found\e[0m\n"
      else
        expiration_time=$(echo "$webhook" | jq -r '.expirationTime')
        printf "$webhook_name Webhook ID: $webhook_id - Status: \e[32mActive\e[0m\n"
        echo "Expiration Time: $expiration_time"
      fi
    fi
  else
    # The response is not valid JSON
    printf "$webhook_name Webhook ID: $webhook_id - Status: \e[31mError\e[0m\n"
    echo "Error Details: Response is not valid JSON. Raw response:"
    echo "$RESPONSE"
  fi
  echo "----------------------------------------"
}

# Check the PAT by making a simple request
PAT_RESPONSE=$(curl -s -X GET "https://api.airtable.com/v0/meta/bases" \
  -H "Authorization: Bearer $AIRTABLE_PERSONAL_ACCESS_TOKEN")

# For Personal Access Token Status
if echo "$PAT_RESPONSE" | grep -q '"error"'; then
  printf "Personal Access Token Status: \e[31mInvalid or Expired\e[0m\n"
  echo "Error Details: $(echo "$PAT_RESPONSE" | jq '.error.message')"
  exit 1
else
  printf "Personal Access Token Status: \e[32mValid\e[0m\n"
  echo "----------------------------------------"
fi

# Check the status of each webhook
# Ensure that the webhook IDs are set in your environment files
if [ -z "$AGENDA_WEBHOOK_ID" ] || [ -z "$ALERTS_WEBHOOK_ID" ]; then
  echo "Webhook IDs are not set in '$ENV_FILE'."
  exit 1
fi

check_webhook_status "$AGENDA_WEBHOOK_ID" "Agenda"
check_webhook_status "$ALERTS_WEBHOOK_ID" "Alerts"
