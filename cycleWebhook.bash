#!/bin/bash

# Load the current environment variables from .dev.vars
source .dev.vars

# Function to delete a webhook
delete_webhook() {
  local WEBHOOK_ID=$1
  local WEBHOOK_TYPE=$2

  echo "Deleting old webhook $WEBHOOK_TYPE with ID: $WEBHOOK_ID and PAT: $AIRTABLE_PERSONAL_ACCESS_TOKEN"

  # Delete the webhook
  RESPONSE=$(curl -s -X DELETE "https://api.airtable.com/v0/bases/$AIRTABLE_BASE_ID/webhooks/$WEBHOOK_ID" \
    -H "Authorization: Bearer $AIRTABLE_PERSONAL_ACCESS_TOKEN")

  # Check the response to ensure deletion was successful
  if [ -z "$RESPONSE" ]; then
    echo "Webhook $WEBHOOK_TYPE deleted successfully."
  else
    echo "Failed to delete webhook $WEBHOOK_TYPE. Response: $RESPONSE"
  fi
}

# Function to create a webhook and update .dev.vars
create_webhook() {
  local WEBHOOK_URL=$1
  local TABLE_ID=$2
  local WEBHOOK_TYPE=$3

  echo "Creating new webhook for $WEBHOOK_TYPE..."

  # Create the new webhook
  RESPONSE=$(curl -s -X POST "https://api.airtable.com/v0/bases/$AIRTABLE_BASE_ID/webhooks" \
    -H "Authorization: Bearer $AIRTABLE_PERSONAL_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{
      "notificationUrl": "'"$WEBHOOK_URL"'",
      "specification": {
        "options": {
          "filters": {
            "dataTypes": ["tableData"],
            "recordChangeScope": "'"$TABLE_ID"'"
          }
        }
      }
    }')

  # Extract the ID, MAC secret, and expiration time from the response
  NEW_WEBHOOK_ID=$(echo "$RESPONSE" | jq -r '.id')
  MAC_SECRET=$(echo "$RESPONSE" | jq -r '.macSecretBase64')
  EXPIRATION=$(echo "$RESPONSE" | jq -r '.expirationTime')

  if [ "$NEW_WEBHOOK_ID" != "null" ]; then
    echo "$WEBHOOK_TYPE webhook created successfully. ID: $NEW_WEBHOOK_ID, Expiration: $EXPIRATION"
    echo "RESPONSE: $RESPONSE"

    # Update .dev.vars file
    echo "Updating .dev.vars with new webhook details for $WEBHOOK_TYPE..."
    
    # Use temporary file for safer write
    tmp_file=$(mktemp)
    cp .dev.vars $tmp_file

    # Write the new webhook details, use correct sed for macOS
    sed -i '' "s|^${WEBHOOK_TYPE}_WEBHOOK_ID=.*|${WEBHOOK_TYPE}_WEBHOOK_ID='$NEW_WEBHOOK_ID'|" $tmp_file
    sed -i '' "s|^${WEBHOOK_TYPE}_MAC_SECRET_BASE64=.*|${WEBHOOK_TYPE}_MAC_SECRET_BASE64='$MAC_SECRET'|" $tmp_file
    sed -i '' "s|^${WEBHOOK_TYPE}_EXPIRATION=.*|${WEBHOOK_TYPE}_EXPIRATION='$EXPIRATION'|" $tmp_file

    # Replace the original file with the updated one
    mv $tmp_file .dev.vars

    echo "$WEBHOOK_TYPE webhook details updated in .dev.vars."
  else
    echo "Failed to create webhook for $WEBHOOK_TYPE. Response: $RESPONSE"
  fi
}

# Replace these with the values from .dev.vars
TABLE_ID_1="$AGENDA_TABLE_ID"
TABLE_ID_2="$ALERTS_TABLE_ID"

# Delete the old webhooks
delete_webhook "$AGENDA_WEBHOOK_ID" "AGENDA"
delete_webhook "$ALERTS_WEBHOOK_ID" "ALERTS"

# Create new webhooks and update .dev.vars
create_webhook "https://airtable-worker-dev.keypom.workers.dev/webhook/agenda" "$TABLE_ID_1" "AGENDA"
create_webhook "https://airtable-worker-dev.keypom.workers.dev/webhook/alerts" "$TABLE_ID_2" "ALERTS"

echo "Webhooks recreated and .dev.vars updated with new details."
