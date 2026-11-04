use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream::Stream;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct EventBus {
    pub sender: broadcast::Sender<String>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }
}

pub async fn handle_events_sse(
    bus: Arc<EventBus>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = bus.sender.subscribe();

    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        match rx.recv().await {
            Ok(msg) => {
                let event = Event::default().event("message").data(msg);
                Some((Ok(event), rx))
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {
                let event = Event::default().event("lagged").data("{\"warning\":\"lagged\"}");
                Some((Ok(event), rx))
            }
            Err(broadcast::error::RecvError::Closed) => None,
        }
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}
