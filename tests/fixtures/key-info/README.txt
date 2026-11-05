Provider answers for the key-info tests (tests/key-info.test.ts). No real key was used.

*.recorded.json: real answers, recorded with no key or an obviously fake key.
Everything else: the provider's documented sample answers and error shapes.
fal-403-locked.queue-shape.json: the queue API's answer for a locked account (the same words as
tests/helpers/fake-cloud.ts). fal.ai doesn't document the Platform API's answer for a locked account.

Sources:
- https://fal.ai/docs/platform-apis/v1/account/billing
- https://fal.ai/docs/platform-apis/v1/models/usage
- https://api.replicate.com/openapi.json (account.get)
- https://replicate.com/docs/reference/http (rate limits)
