use super::*;
#[test]
fn export_rejects_files_outside_preview_cache() {
    let source=env::temp_dir().join(format!("{}.gcode",uid("simpliy-other-test")));
    let output=env::temp_dir().join(format!("{}.gcode",uid("simpliy-outside-export")));
    fs::write(&source,b"G1 X1\n").unwrap();
    let result=tauri::async_runtime::block_on(export_preview(source.to_string_lossy().into_owned(),output.to_string_lossy().into_owned()));
    assert!(result.is_err());assert!(!output.exists());fs::remove_file(source).unwrap();
}
#[test]
#[ignore = "requires explicit local Prusa engine and fixture paths"]
fn real_preview_slice_and_export() {
    let engine=env::var("SIMPLIY_TEST_ENGINE").expect("SIMPLIY_TEST_ENGINE");
    let config: Value=serde_json::from_slice(&fs::read(env::var("SIMPLIY_TEST_CONFIG").expect("SIMPLIY_TEST_CONFIG")).unwrap()).unwrap();
    let model=env::var("SIMPLIY_TEST_MODEL").expect("SIMPLIY_TEST_MODEL");
    let job: project::Job=serde_json::from_value(json!({"config":config,"applied":[],"models":[{"path":model,"name":"Preview test","matrix":[1,0,0,0,1,0,0,0,1,115,95,0]}]})).unwrap();
    let export=env::temp_dir().join(format!("{}.gcode",uid("simpliy-export-test")));
    assert!(!export.exists());
    let result=tauri::async_runtime::block_on(slice_preview(engine,job)).expect("preview slice");
    let preview=result["output"].as_str().unwrap().to_string();
    assert!(!export.exists(),"preview should not create the user export");
    let content=fs::read_to_string(&preview).unwrap();assert!(content.contains(";LAYER_CHANGE"));
    tauri::async_runtime::block_on(export_preview(preview.clone(),export.to_string_lossy().into_owned())).expect("export");
    assert_eq!(fs::read(&export).unwrap(),fs::read(&preview).unwrap());
    assert!(tauri::async_runtime::block_on(export_preview(preview.clone(),export.to_string_lossy().into_owned())).is_err(),"existing output must never be overwritten");
    fs::remove_file(export).unwrap();fs::remove_file(preview).unwrap();
}
#[test]
#[ignore = "requires explicit local Prusa engine and generated internal support job"]
fn real_internal_support_preview() {
    let engine=env::var("SIMPLIY_TEST_ENGINE").unwrap();
    let data=fs::read(env::var("SIMPLIY_TEST_SUPPORT_JOB").unwrap()).unwrap();
    let job: project::Job=serde_json::from_slice(&data).unwrap();
    let result=tauri::async_runtime::block_on(slice_preview(engine,job)).expect("internal support preview");
    println!("Support report: {}", result["supportInfo"]);
    if let Ok(expected)=env::var("SIMPLIY_TEST_SUPPORT_EXPECT") {
        assert!(result["supportInfo"]["text"].as_str().unwrap_or("").contains(&expected), "unexpected support result");
    }
    let source=result["output"].as_str().unwrap();let content=fs::read_to_string(source).unwrap();
    assert!(content.contains(";TYPE:Support material"),"support paths missing");
    fs::write(env::var("SIMPLIY_TEST_SUPPORT_OUTPUT").unwrap(),content).unwrap();
    fs::remove_file(source).unwrap();
}
#[test]
#[ignore = "requires local engine and a mixed-automatic support job"]
fn mixed_support_binary_is_rejected_before_slicing() {
    let engine=env::var("SIMPLIY_TEST_ENGINE").unwrap();
    let data=fs::read(env::var("SIMPLIY_TEST_SUPPORT_JOB").unwrap()).unwrap();
    let mut job: project::Job=serde_json::from_slice(&data).unwrap();
    job.config["configuration"]["printer_settings"]["binary_gcode"]=json!(true);
    let error=tauri::async_runtime::block_on(slice_preview(engine,job)).unwrap_err();
    assert!(error.contains("Text-G-Code"),"{error}");
}

#[test]
#[ignore = "requires explicit local Prusa engine and fixture paths"]
fn real_binary_preview_export() {
    let engine=env::var("SIMPLIY_TEST_ENGINE").expect("SIMPLIY_TEST_ENGINE");
    let mut config: Value=serde_json::from_slice(&fs::read(env::var("SIMPLIY_TEST_CONFIG").expect("SIMPLIY_TEST_CONFIG")).unwrap()).unwrap();
    config["configuration"]["printer_settings"]["binary_gcode"]=json!(true);
    let model=env::var("SIMPLIY_TEST_MODEL").expect("SIMPLIY_TEST_MODEL");
    let job: project::Job=serde_json::from_value(json!({"config":config,"applied":[],"models":[{"path":model,"name":"Binary preview","matrix":[1,0,0,0,1,0,0,0,1,115,95,0]}]})).unwrap();
    let result=tauri::async_runtime::block_on(slice_preview(engine,job)).expect("binary preview");
    let preview=result["output"].as_str().unwrap().to_string();
    assert!(preview.ends_with(".bgcode"));assert!(fs::metadata(&preview).unwrap().len()>100);
    let export=env::temp_dir().join(format!("{}.bgcode",uid("simpliy-binary-test")));
    tauri::async_runtime::block_on(export_preview(preview.clone(),export.to_string_lossy().into_owned())).expect("binary export");
    assert_eq!(fs::read(&export).unwrap(),fs::read(&preview).unwrap());
    fs::remove_file(export).unwrap();fs::remove_file(preview).unwrap();
}
