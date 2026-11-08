# RiverPokerLab Tournaments

Tournaments is a standalone, responsive Hebrew RTL shell. It publishes separately
from the solver and uses a fixture-only anonymous session for the club, floor,
cashier, dealer, and read-only audience screens. Station links are navigation,
not authorization. There is no account access or server mutation endpoint. The floor setup stores
one local tournament per browser origin. Phase 3 adds the cashier and floor
seating workflows on the same origin. Writes use Web Locks and require a
supporting browser on localhost or another secure origin. Tabs share data, but
separate devices and browser profiles do not.

## Registration and seating

- Open registration in floor setup, then add an open table in the floor seating
  screen. Additional tables can be marked ready for automatic activation.
- The default early-opening threshold is seven occupied seats per open table,
  capped by each table's capacity. The floor can change the threshold.
- The cashier confirms payment before allocating a seat. Reprinting a slip
  does not change entries or payments. After a move the slip shows the player's
  current seat.
- Re-entry checks the player's elimination and configured cap. Live elimination
  controls are scheduled for Phase 4.

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
