// K — ShiftEventHub unit tests.
// These exercise the hub directly (no HTTP, no DB). The hub's job is to fan out one
// `participants-updated` event per shift_id to every active subscriber on that shift.
// `subscribe` always returns a fresh receiver; `publish_*` is fire-and-forget. The
// SSE handler layers a `BroadcastStream` wrapper that converts a
// `BroadcastStreamRecvError::Lagged` into a synthetic catch-up event — K5 documents
// the underlying broadcast::Receiver lag behavior the wrapper relies on.

use tokio::sync::broadcast::error::TryRecvError;
use uuid::Uuid;

use crate::state::ShiftEventHub;

// K1 — subscribe then publish → receiver gets exactly one message of the right type.
#[tokio::test]
async fn k1_subscribe_then_publish_delivers_event() {
    let hub = ShiftEventHub::default();
    let shift_id = Uuid::new_v4();

    let mut rx = hub.subscribe(shift_id);
    hub.publish_participants_updated(shift_id);

    let event = rx.recv().await.expect("must receive the published event");
    assert_eq!(event.event_type, "participants-updated");
    assert_eq!(event.shift_id, shift_id);

    // No further events are queued.
    assert!(matches!(rx.try_recv(), Err(TryRecvError::Empty)));
}

// K2 — two subscribers on the same shift_id both receive the event.
#[tokio::test]
async fn k2_two_subscribers_same_shift_both_receive() {
    let hub = ShiftEventHub::default();
    let shift_id = Uuid::new_v4();

    let mut rx_a = hub.subscribe(shift_id);
    let mut rx_b = hub.subscribe(shift_id);
    hub.publish_participants_updated(shift_id);

    let a = rx_a.recv().await.unwrap();
    let b = rx_b.recv().await.unwrap();
    assert_eq!(a.shift_id, shift_id);
    assert_eq!(b.shift_id, shift_id);
}

// K3 — subscribers on a different shift_id do not receive cross-talk.
#[tokio::test]
async fn k3_different_shift_id_does_not_receive() {
    let hub = ShiftEventHub::default();
    let shift_a = Uuid::new_v4();
    let shift_b = Uuid::new_v4();

    let mut rx_a = hub.subscribe(shift_a);
    let mut rx_b = hub.subscribe(shift_b);
    hub.publish_participants_updated(shift_a);

    rx_a.recv().await.unwrap();
    assert!(
        matches!(rx_b.try_recv(), Err(TryRecvError::Empty)),
        "shift B subscriber must not receive shift A events"
    );
}

// K4 — subscribe AFTER a publish → no message buffered (broadcast is live, not replay).
#[tokio::test]
async fn k4_subscribe_after_publish_receives_nothing() {
    let hub = ShiftEventHub::default();
    let shift_id = Uuid::new_v4();

    hub.publish_participants_updated(shift_id); // No subscriber yet — message is dropped.
    let mut rx = hub.subscribe(shift_id);

    assert!(
        matches!(rx.try_recv(), Err(TryRecvError::Empty)),
        "broadcast does not buffer for late subscribers"
    );
}

// K5 — overflow: publishing past the channel capacity (32) before draining produces a
// `Lagged` on the next read. The SSE handler wrapper converts this to a synthetic
// catch-up event; here we just assert the underlying broadcast behavior the wrapper
// relies on.
#[tokio::test]
async fn k5_lagging_subscriber_observes_lag() {
    let hub = ShiftEventHub::default();
    let shift_id = Uuid::new_v4();
    let mut rx = hub.subscribe(shift_id);

    for _ in 0..40 {
        hub.publish_participants_updated(shift_id);
    }

    // After overflowing past capacity (32), the next recv reports Lagged with the count
    // of skipped messages. We don't assert the exact count — only that we observe Lagged.
    let result = rx.recv().await;
    match result {
        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
        Ok(_) => panic!("expected Lagged, got Ok"),
        Err(other) => panic!("expected Lagged, got Err: {other}"),
    }
}
