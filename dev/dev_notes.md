# Dev Notes

- Review and refactor the `ACCEPTED` / `CACHE_READY` participant state split. The current flow should be reconsidered to decide whether these remain separate states or should be merged/simplified.
- Replace current shift polling with SSE so current shift state changes are pushed instead of periodically fetched.
