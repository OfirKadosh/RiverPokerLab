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
  controls are available in the paired dealer station.

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

## Dealer station

- Start a dealer shift, assign the dealer to an open table and issue a
  one-time code from the floor shift screen. Enter the code in a separate tab
  on the same browser origin. The pairing is scoped to that tab and survives
  refresh. The floor can revoke it. Codes expire after five minutes.
- The dealer can swap with an unassigned dealer on shift, confirm an
  elimination and operate the table's independent 30-second clock.
- The full-viewport clock uses the same deadline as the table view. A tap
  resets a running or expired clock, or resumes a paused clock. Leaving the
  clock view preserves its state.
- The local role and pairing flows are for testing. Real devices will need
  shared server state and server-validated permissions.

## Identity integration

Keep the solver login flow separate. Replace the fixture session with a
server-validated club membership before enabling writes. Link the intended Ofir
account by its verified stable account ID, and check each action against
membership, role, and tournament or table scope on the server. The fixture
session must never grant access to real users or club data.

## Live tournament

Open registration in floor setup, then start from the live floor screen.
The shared timeline stores an elapsed offset and a clock anchor, so a reload
or a sleeping tab catches up without replaying ticks. Late registration can
close at the start, at a level boundary or after active play minutes. Breaks
and pauses do not consume active play time. A correction after closing
registration cannot reopen it. Future breaks can be moved or resized.

The audience screen is read-only and shares the same timeline, registration
and player counts across tabs on the same origin. This stage still uses local
browser storage. Separate devices require server-backed state.

## Prizes and results

After registration closes, the floor and the audience can see the projected
payouts calculated from recorded entries. The floor can edit the percentages
(up to 30 paid places and at most the number of registered players). For local
testing the editable defaults are 100%, 65/35 or 50/30/20 for one, two or at
least three players. Percentages must sum to 100%. Whole-agora payouts use the
largest-remainder method with ties broken by finishing place. Bounty is shown
as a separate pool and is handled physically at the tables.

The floor records one distinct player per paid place and explicitly closes the
tournament. Subsequent ranking corrections require a reason and keep before
and after snapshots in the local audit log. Before closing, the floor can undo
an elimination if the original seat is still available. This workflow records
results and amounts only; it does not process payouts.

## Motion and sound

Screens and clock digits animate unless the device requests reduced motion.
The dealer clock uses red digits during the final five seconds. On the live
floor or audience screen, enable the level chime with the sound button.
Browsers require a user gesture before audio can play, so enable it on the
one screen that should make sound. The chime marks a naturally elapsed
blind level, including a level that leads into a break.

## Persistent local club and roster

Run `node server.mjs` from this directory with Node.js 24 or later and open
`http://127.0.0.1:8080/#staff`. The local server binds to loopback and stores the
club and staff in `data/club.sqlite`. Set `TOURNAMENTS_DB` to use a different
database file, and `PORT` to use a different port. The server seeds the local
club and sample employees once, preserving the existing dealer IDs.

The owner can edit the club and add floor, cashier or dealer employees.
The shift screen loads dealers from that roster when opened and on focus.
This development server has no login and is limited to the local machine.
The existing static preview continues to work with sample employees. Existing
tournament state and dealer table assignments still use the browser store.

## Local owner and attendance

Set `TOURNAMENTS_OWNER_PASSWORD` in the server environment before launching
`node server.mjs`. Open `/#staff` and sign in with that password. The local
club has one owner credential, with an eight-hour session that ends on server
restart. The owner manages the roster and can view monthly attendance totals
and shift details in Israel time. Removing a worker archives the worker and
preserves completed shifts. Close any open shift before removing the worker.

Open `/#attendance` at the shared local station to record clock-in and
clock-out for any active worker. Attendance measures working time separately
from dealer assignments within a tournament. The local station selects an
employee by name; individual employee accounts are not implemented here.

After displaying prizes, the floor can archive a completed tournament from
the results screen. The local Node server writes a snapshot to SQLite before
the browser removes its working copy. Owners can view it at `/#archive`.
Empty tournaments can be closed without archiving. The floor reset clears
all browser tournament data and leaves the roster, attendance and owner
archive intact. This development server binds to loopback.

## Running parallel tournaments

Use the tournament picker in the floor, cashier, dealer or audience station.
The selection is per tab, and a station URL with `?t=<id>` pins a tournament.
Use **New tournament** from the floor to open a separate setup. The local
store reads the previous single-tournament format and preserves it in the
new list on the next write. Tabs still need the same browser origin.

New setups include 25 generated blind levels. Select a structure beside the
default level duration and load it explicitly; changing the default duration
updates every level. To close a table, choose a distinct free seat at another
open table for every player. Transfers and closure are saved together.
After late registration closes, use **Finish tournament** on the live floor
screen to enter paid places and save the result.
