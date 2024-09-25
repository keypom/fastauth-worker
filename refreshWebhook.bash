#!/bin/bash

# Load the current environment variables from .dev.vars
source .dev.vars

# Function to refresh a webhook
refresh_webhook() {
  local WEBHOOK_ID=$1
  local WEBHOOK_TYPE=$2

  echo "Refreshing webhook $WEBHOOK_TYPE with ID: $WEBHOOK_ID"

  # Refresh the webhook
  RESPONSE=$(curl -s -X POST "https://api.airtable.com/v0/bases/$AIRTABLE_BASE_ID/webhooks/$WEBHOOK_ID/refresh" \
    -H "Authorization: Bearer $AIRTABLE_PERSONAL_ACCESS_TOKEN" \
    -H "Content-Type: application/json")

  # Extract the new expiration time from the response
  NEW_EXPIRATION=$(echo "$RESPONSE" | jq -r '.expirationTime')

  # Check if the refresh was successful
  if [ "$NEW_EXPIRATION" != "null" ]; then
    echo "Webhook $WEBHOOK_TYPE refreshed successfully. New expiration time: $NEW_EXPIRATION"

    # Replace the expiration time in the .dev.vars file
    sed -i '' "s|^${WEBHOOK_TYPE}_EXPIRATION=.*|${WEBHOOK_TYPE}_EXPIRATION='$NEW_EXPIRATION'|" .dev.vars

  else
    echo "Failed to refresh webhook $WEBHOOK_TYPE. Response: $RESPONSE"
  fi
}

# Refresh Agenda Webhook
refresh_webhook "$AGENDA_WEBHOOK_ID" "AGENDA"

# Refresh Alerts Webhook
refresh_webhook "$ALERTS_WEBHOOK_ID" "ALERTS"

echo "Webhooks refreshed. Updated expiration times have been written to .dev.vars."
