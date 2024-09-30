#!/bin/bash

# Load the current environment variables from .dev.vars
source .dev.vars

# Make a simple GET request to view the status of the webhooks
echo "Viewing status of webhooks on base: $AIRTABLE_BASE_ID with PAT: $AIRTABLE_PERSONAL_ACCESS_TOKEN"

RESPONSE=$(curl -s -X GET "https://api.airtable.com/v0/bases/$AIRTABLE_BASE_ID/webhooks" \
  -H "Authorization: Bearer $AIRTABLE_PERSONAL_ACCESS_TOKEN" \
  -H "Content-Type: application/json")

# Output the response
echo "$RESPONSE"
