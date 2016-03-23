## Slack bot TFL (bus)

Slack bot that integrates with TFL API.

## Integration

Add TFL_APP_ID and TFL_KEYS as environment variables.

## Commands

> stops near

Opens a conversation requesting the postcode to display the 10 bus stations
closer to the postcode location.

> stops add `<label>` `<stop id>`

Adds a stop by id (see "stops near") to a labeled list.
i.e. "stops add home 490003174S"

> next `<label>`

Shows the next 5 bus arrivals in the stops listed for that label.
i.e. "next home"

> stops list `<label>`

Displays the stops listed under the label.

> stops delete `<label>` `<stop id>`

Removes the stop id from the label.
i.e. "stops delete home 490003174S"
