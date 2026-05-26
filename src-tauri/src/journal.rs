// Append-only journal of unsaved buffer snapshots.
// One JSONL file per buffer id under <app_local_data>/journals/.
// Each line is a full snapshot; retain only the last RETAIN_SNAPSHOTS lines
// after every append to bound disk usage.

use serde::{Deserialize, Serialize};

/// Maximum snapshots retained per buffer journal file.
pub const RETAIN_SNAPSHOTS: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    /// File path on disk, or null for untitled buffers.
    pub path: Option<String>,
    pub content: String,
    /// Wire format matches src/stores/buffers.ts Encoding union.
    pub encoding: String,
    /// Wire format matches src/stores/buffers.ts LineEnding union.
    pub eol: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestoredEntry {
    /// Buffer id this entry came from (filename without `.jsonl`).
    pub buffer_id: String,
    pub snapshot: Snapshot,
}
