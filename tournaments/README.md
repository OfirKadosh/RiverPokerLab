# RiverPokerLab Tournaments

Tournaments is a standalone, responsive Hebrew RTL shell. It publishes separately
from the solver and uses a fixture-only anonymous session for the club, floor,
cashier, dealer, and read-only audience screens. Station links are navigation,
not authorization. There is no account access or mutation endpoint. Phase 2 adds a local
tournament setup, accessible from the floor station. One draft or registration
configuration is stored per browser origin using localStorage. Opening
registration records a local status. Player intake belongs to Phase 3.

## Run

Serve `public` over HTTP, for example `python3 -m http.server 8080 --directory public`
from this directory. For a Git-backed static deployment, publish
`tournaments/public` from the feature branch with a no-op build command.
Hash-based navigation works with a static host.

## Setup behavior

- The Regular and Turbo presets use 20-minute and 12-minute levels. Selecting
  the pace preserves edits. Loading a template explicitly replaces levels and breaks.
- The default level duration applies to newly added levels. Existing levels are
  editable individually. Late registration can end at start, after a level,
  or after a number of active play minutes.
- The fee is denominated in ILS up to ₪10,000. Rake and fixed bounty options
  use ₪10 increments plus the exact remaining amount. Calculations use cents.

## Identity integration

Keep the solver login flow separate. Replace the fixture session with a
server-validated club membership before enabling writes. Link the intended Ofir
account by its verified stable account ID, and check each action against
membership, role, and tournament or table scope on the server. The fixture
session must never grant access to real users or club data.
