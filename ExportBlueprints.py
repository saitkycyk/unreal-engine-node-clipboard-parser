import unreal
import os
import shutil
import subprocess

def export_nightclub_blueprints():
    project_dir = unreal.Paths.project_dir()
    parent_dir = os.path.abspath(os.path.join(project_dir, ".."))
    
    # 1. Define the MAIN folder
    base_export_dir = os.path.join(parent_dir, "Nightclub_Parsed_Blueprints").replace("\\", "/")
    
    # 2. Define the SUBFOLDER for the raw T3D files
    t3d_export_dir = os.path.join(base_export_dir, "Raw_T3D").replace("\\", "/")
    
    # 3. Wipe the entire main folder to clear out old Markdown and T3D files
    if os.path.exists(base_export_dir):
        unreal.log(f"Clearing existing directory for fresh export: {base_export_dir}")
        shutil.rmtree(base_export_dir)
        
    # 4. Recreate the main folder AND the subfolder
    os.makedirs(t3d_export_dir)
        
    asset_registry = unreal.AssetRegistryHelpers.get_asset_registry()
    bp_class_path = unreal.TopLevelAssetPath(package_name="/Script/Engine", asset_name="Blueprint")
    
    target_paths = [
        "/Game/Characters",
        "/Game/Interface",
        "/Game/Packages"
    ]
    
    ar_filter = unreal.ARFilter(class_paths=[bp_class_path], package_paths=target_paths, recursive_paths=True)
    assets = asset_registry.get_assets(ar_filter)
    
    export_count = 0
    
    for asset_data in assets:
        package_name = str(asset_data.package_name)
        if "/Storage/" in package_name:
            continue
            
        blueprint_asset = unreal.EditorAssetLibrary.load_asset(package_name)
        filename = f"{asset_data.asset_name}.t3d"
        
        # 5. Save the T3D specifically to the subfolder
        full_path = os.path.join(t3d_export_dir, filename).replace("\\", "/")
        
        task = unreal.AssetExportTask()
        task.object = blueprint_asset
        task.filename = full_path
        task.automated = True    
        task.prompt = False      
        task.exporter = unreal.ObjectExporterT3D()
        
        unreal.Exporter.run_asset_export_task(task)
        export_count += 1

    unreal.log(f"SUCCESS! Exported {export_count} Blueprints to: {t3d_export_dir}")

    # Trigger Node.js
    unreal.log("Starting JavaScript Parser...")
    current_script_dir = os.path.dirname(os.path.abspath(__file__))
    node_script_path = os.path.join(current_script_dir, "batchParse.js").replace("\\", "/")
    
    try:
        result = subprocess.run(["node", node_script_path], check=True, capture_output=True, text=True)
        unreal.log(result.stdout)
        unreal.log("Parser finished successfully! Markdown docs are ready.")
    except subprocess.CalledProcessError as e:
        # Prints exact Node.js errors to the Unreal log
        unreal.log_error(f"Node.js crashed! Error:\n{e.stderr}\nConsole Output:\n{e.stdout}")
    except Exception as e:
        unreal.log_error(f"Failed to trigger Node.js. System Error: {e}")

export_nightclub_blueprints()