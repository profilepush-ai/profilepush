# Push notification worker

Queues every in-app notification for delivery through OneSignal and Firebase Cloud Messaging.

## Resources

- Worker: `profilepush-push-notifications`
- Queue: `push-notifications`
- Dead-letter queue: `push-notifications-dlq`

## Secrets

- `PUSH_QUEUE_TOKEN`: shared only with the Supabase `send-push-notification` bridge
- `ONESIGNAL_REST_API_KEY`: OneSignal app REST API key

The consumer retries failed deliveries five times before moving them to the dead-letter queue.