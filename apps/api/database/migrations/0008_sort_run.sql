-- "Sort now" survives a restart: the run is written down when it starts and when it ends, so a server that was
-- stopped in the middle (a deploy, a crash) picks the same run up again and the page keeps showing one bar.
ALTER TABLE scheduler_state
    ADD COLUMN run_active     boolean NOT NULL DEFAULT false,
    ADD COLUMN run_total      integer NOT NULL DEFAULT 0,
    ADD COLUMN run_started_at timestamptz;
