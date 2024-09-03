## Automate Sending Emails for Redacted
This script pulls data from the attendee Airtable using [Airtable-JS](https://github.com/Airtable/airtable.js), then sends emails according to values in the airtable. 

Each run is logged in `src/data/result-MM-DD-YYY.json`, with the most recent Airtable state pulled into `src/data/airtable-export.json`. After running the script, approved attendees will have emails sent and the statuses will either be 

1) `delivered`, requiring no followup
2) `failed`, which means the email bounced. Usually this means the address was wrong.
3) `FLAGGED`, which means that they were queued to be sent, but after a set number of checks, the status was neither `delivered` nor `failed`. It can also indicate an [error in the script](src/email.js#L125). 