# RiverPokerLab Tournaments

Phase 1 is a standalone, responsive Hebrew RTL shell. It publishes separately
from the solver and uses a fixture-only anonymous session for the club, floor,
cashier, dealer, and read-only audience screens. Station links are navigation,
not authorization. There is no account access, storage, or mutation endpoint.

## Run

Serve `public` over HTTP, for example `python3 -m http.server 8080 --directory public`
from this directory. For a Git-backed static deployment, publish
`tournaments/public` from the feature branch with a no-op build command.
Hash-based navigation works with a static host.

## Identity integration

Keep the solver login flow separate. Replace the fixture session with a
server-validated club membership before enabling writes. Link the intended Ofir
account by its verified stable account ID, and check each action against
membership, role, and tournament or table scope on the server. The fixture
session must never grant access to real users or club data.
