use super::*;
/// Echte Dateien gegen die echte Engine: SIMPLIY_TEST_ENGINE, SIMPLIY_TEST_IMPORT (Dateien mit ;), SIMPLIY_TEST_IMPORT_OUT.
#[test]
#[ignore]
fn real_files() {
    let engine = env::var("SIMPLIY_TEST_ENGINE").unwrap();
    let out = PathBuf::from(env::var("SIMPLIY_TEST_IMPORT_OUT").unwrap());
    let skeleton = json!({"printer": "Prusa MK3S & MK3S+ 0.4", "print": "0.15mm QUALITY @MK3 0.4", "tool": "no tool", "filament": "Generic PLA@MK2.5_MK3 0.4"});
    for (i, path) in env::var("SIMPLIY_TEST_IMPORT").unwrap().split(';').enumerate() {
        let data = fs::read(path).unwrap();
        let answer = import_prusa_file(&engine, path, &data, &skeleton).unwrap_or_else(|e| json!({"error": e}));
        fs::write(out.join(format!("{i}.json")), serde_json::to_vec(&answer).unwrap()).unwrap();
    }
}
