#!/bin/bash

# Prompt the user for the Airtable PAT
echo "Enter the Airtable PAT you want to check:"
read -s AIRTABLE_PAT

# Make a simple GET request to list bases and check the PAT's status
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $AIRTABLE_PAT" \
  "https://api.airtable.com/v0/meta/bases")

# Check the HTTP status code
if [ "$RESPONSE" -eq 200 ]; then
  echo "The PAT is valid."
elif [ "$RESPONSE" -eq 401 ]; then
  echo "The PAT has expired or is invalid."
else
  echo "An error occurred. HTTP status code: $RESPONSE"
fi

