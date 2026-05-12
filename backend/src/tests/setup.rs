// Test bootstrap: bring up a Postgres container before any test runs and point
// DATABASE_URL at it. Runs once per `cargo test` invocation via #[ctor::ctor],
// which fires before main (and therefore before any test body).
//
// `#[sqlx::test]` reads DATABASE_URL at runtime to decide where to create its
// per-test database, so as long as we set it here, every test in the binary
// transparently uses the bootstrapped container.
//
// The container handle is intentionally leaked: testcontainers attaches a Ryuk
// sidecar that watches the test process and stops the postgres container when
// the process exits, so we don't need to call Drop ourselves.
//
// If DATABASE_URL is already set in the environment, we honor it and skip the
// bootstrap — useful for pointing a single test run at a remote/local DB
// you've stood up by hand.

use testcontainers::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres;

#[ctor::ctor(unsafe)]
fn boot_postgres() {
    if std::env::var("DATABASE_URL")
        .ok()
        .is_some_and(|v| !v.trim().is_empty())
    {
        return;
    }

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test bootstrap: build tokio runtime");

    let (database_url, container) = runtime.block_on(async {
        let container = Postgres::default()
            .with_tag("17-alpine")
            .start()
            .await
            .expect("test bootstrap: start postgres container");
        let port = container
            .get_host_port_ipv4(5432)
            .await
            .expect("test bootstrap: get postgres host port");
        let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
        (url, container)
    });

    // SAFETY: ctor runs pre-main, before any worker thread that could observe
    // the env. `set_var` is marked unsafe in edition 2024 because of MT
    // hazards; here we're single-threaded.
    unsafe {
        std::env::set_var("DATABASE_URL", &database_url);
    }

    // Keep both the runtime and the container handle alive for the entire
    // process. Ryuk reaps the container on process exit.
    Box::leak(Box::new(runtime));
    Box::leak(Box::new(container));
}
