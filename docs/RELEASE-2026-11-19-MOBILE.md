# Mobile, pickups, music and NPC release

Source baseline: 24c292b91d0885b96ac26f37e8528994a9121fec.
Core build: 683a2ad0905f. Release is the reviewed 14:04 local candidate, not the unfinished weapons/variants/new-track work.

Fresh checks: 193 unit tests; 7 focused network order/worker-host tests; production and test builds; Worker staging dry-run; secret scan 0 findings; phone home/race/menu/pause/resume/quality/music check with no page errors. The full historical network runner did not finish before timeout and is not passed. Prior detailed touch/desktop checks are in MOBILE-CANDIDATE.md.

Unverified: real handset thermal/FPS/battery/audio balance, extended hosted multiplayer soak, actual Workers CPU accounting and max-tick cost. The later weapons candidate's max-tick measurements do not measure this release.

Paired rollout: deploy existing nightgrid-mp-staging Worker from this commit first, then promote this exact frontend source in the existing Vercel NIGHTGRID project. Frontend must report build 683a2ad0905f and mpApiBase https://nightgrid-mp-staging.sameerkapildesigns.workers.dev. No DNS, routes, account tier or spending changes.

Preserved historical rollback pair (revalidate availability before use): frontend source 789aaa08213c99f8fc92065c6b8ced6f91241f26, build ff3815343186; Worker version ee67f594-189e-4015-8b6c-df373d2c63c7. Immediately preceding live source is 24c292b91d0885b96ac26f37e8528994a9121fec; do not confuse it with the older requested rollback pair.
