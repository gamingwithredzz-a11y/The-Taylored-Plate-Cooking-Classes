# Verification record

Backend command: `python -m unittest discover -s tests -v`

Result: **12 tests passed** on September 18, 2026, using the bundled Windows Python runtime.

Covered workflows:

- Closed check-in, missing active week, cohort switching and preserved old attendance.
- Concurrent student check-ins create exactly one attendance event.
- Concurrent unrelated station reservations allow exactly one non-override enrollment.
- Corrections preserve audit history and the changing instructor's UUID.
- Failed couple enrollment leaves no partial reservation.
- Couples share station moves and track attendance independently.
- Malformed JSON and unauthorized requests return clean JSON errors.
- Identical retries return their original response; mismatched request-ID reuse fails.
- Invalid station and week values are rejected.
- Renamed titles appear in student replies; completed students cannot self-check-in.
- Student tokens and unauthorized avatar UUIDs cannot invoke admin commands.
- Explicit capacity overrides and reactivation checks behave as intended.

Not executed here: installation of Waitress into a deployment environment, public HTTPS deployment, LSL compilation in the Second Life viewer, and live simulator integration. Follow the README in-world acceptance checklist before class use. No production secrets or student records are included.
