#!/usr/bin/env python3
import os
import json
import subprocess

class CobaltIntegration:
    def __init__(self):
        self.config = self.load_config() # load_config will handle exit if critical paths are missing

        self.build_dir = self.config.get('build_dir', 'out/default')
        self.output_dir = self.config.get('output_dir', 'dist') # This should match Webpack's output path
        self.cobalt_path = self.config.get('cobalt_path')
        self.platform = self.config.get('platform', 'tizen')
        self.build_flags = self.config.get('build_flags', [])

        # COBALT_APP_CONTENT_PATH is where Webpack's output (e.g. dist/) is copied to by the CI.
        # This path is then used by Cobalt's build system or for packaging.
        self.cobalt_app_content_path_for_build = os.getenv('COBALT_APP_CONTENT_PATH')
        if not self.cobalt_app_content_path_for_build:
            # For CI, this MUST be set by the workflow after copying Webpack's dist.
            # This path is critical for packaging and potentially for the Cobalt build itself.
            print("Error: COBALT_APP_CONTENT_PATH environment variable not set.")
            print("This variable should point to the directory containing the Webpack output (e.g., where 'dist/' was copied).")
            print("Aborting script.")
            exit(1)
        elif not os.path.isdir(self.cobalt_app_content_path_for_build):
            print(f"Error: COBALT_APP_CONTENT_PATH ('{self.cobalt_app_content_path_for_build}') is not a valid directory.")
            print("Aborting script.")
            exit(1)
        else:
            print(f"Using COBALT_APP_CONTENT_PATH from environment: {self.cobalt_app_content_path_for_build}")

    def load_config(self):
        config_file_path = os.getenv('COBALT_CONFIG_PATH', 'cobalt_config.json')
        default_config = {
            'build_dir': 'out/default',
            'output_dir': 'dist',
            'cobalt_path': None,
            'platform': 'tizen',
            'build_flags': [],
            'main_js_bundle_name': 'main.bundle.js' # Default name, can be overridden in config
        }
        try:
            with open(config_file_path, 'r') as f:
                config_data = json.load(f)
                print(f"Loaded configuration from {config_file_path} successfully.")
                # Ensure essential keys have fallbacks if missing in the loaded config
                for key, value in default_config.items():
                    config_data.setdefault(key, value)

                if not config_data.get('cobalt_path'):
                    print(f"Error: 'cobalt_path' is not defined in {config_file_path}.")
                    print("Please ensure 'cobalt_path' points to your Cobalt checkout directory.")
                    exit(1)
                if not os.path.isdir(config_data['cobalt_path']):
                    print(f"Error: 'cobalt_path' ('{config_data['cobalt_path']}') in {config_file_path} is not a valid directory.")
                    exit(1)

                return config_data
        except FileNotFoundError:
            print(f"Error: Configuration file '{config_file_path}' not found.")
            print("Please create it or ensure COBALT_CONFIG_PATH env var is set correctly.")
            exit(1)
        except json.JSONDecodeError as e:
            print(f"Error decoding {config_file_path}: {e}. Aborting.")
            exit(1)

    def _run_subprocess(self, command_args, operation_name="Subprocess", cwd=None):
        """Helper to run subprocesses and handle errors."""
        effective_cwd = cwd if cwd else os.getcwd()
        print(f"Running: {' '.join(command_args)} (in {effective_cwd})")
        try:
            result = subprocess.run(command_args, check=True, capture_output=True, text=True, cwd=effective_cwd)
            if result.stdout:
                print(f"{operation_name} STDOUT:\n{result.stdout}")
            if result.stderr:
                print(f"{operation_name} STDERR:\n{result.stderr}")
            print(f"{operation_name} completed successfully.")
            return True
        except subprocess.CalledProcessError as e:
            print(f"{operation_name} failed. Return code: {e.returncode}")
            if e.stdout: print(f"STDOUT:\n{e.stdout}")
            if e.stderr: print(f"STDERR:\n{e.stderr}")
            return False
        except FileNotFoundError:
            print(f"{operation_name} failed: Command '{command_args[0]}' not found. Ensure it's in your PATH.")
            return False
        except Exception as e:
            print(f"{operation_name} failed with an unexpected error: {e}")
            return False

    def build_cobalt(self):
        # Pre-build check: Ensure essential web assets (e.g., main JS bundle) are in COBALT_APP_CONTENT_PATH_FOR_BUILD
        # This is important if Cobalt's GN/Ninja setup directly references these files during its compile/link phases.
        main_bundle_name = self.config.get('main_js_bundle_name', 'main.bundle.js') # Get from config or default
        # If webpack uses contenthash, the exact name might vary. `main.*.js` could be a pattern.
        # For simplicity, expect a known name or that `dist` contains one main JS.
        expected_bundle_path = os.path.join(self.cobalt_app_content_path_for_build, main_bundle_name)

        # A more robust check might look for any *.bundle.js if names are hashed.
        # For now, we check for the specific or default name.
        found_bundle = os.path.isfile(expected_bundle_path)
        if not found_bundle:
            # Try finding any file matching main.*.js pattern if specific name not found
            if main_bundle_name == 'main.bundle.js': # Only if default was used
                 alt_bundle_pattern = os.path.join(self.cobalt_app_content_path_for_build, "main.*.js")
                 import glob
                 matching_files = glob.glob(alt_bundle_pattern)
                 if matching_files:
                     print(f"Found potential main bundle: {matching_files[0]}")
                     found_bundle = True

        if not found_bundle:
            print(f"Error: Main JS bundle ('{main_bundle_name}' or pattern 'main.*.js') not found in COBALT_APP_CONTENT_PATH: {self.cobalt_app_content_path_for_build}")
            print("Ensure Webpack output has been copied to this location before Cobalt build.")
            return False
        print(f"Verified JS bundle presence in {self.cobalt_app_content_path_for_build}.")

        # The ninja command should be run from within the cobalt_path, and -C points to the build output directory.
        ninja_cwd = self.cobalt_path
        ninja_build_dir_abs = os.path.join(self.cobalt_path, self.build_dir)

        build_target = f'cobalt_{self.platform}'
        command = ['ninja', '-C', ninja_build_dir_abs] # -C path is relative to where ninja is run, or absolute
        command.extend(self.build_flags)
        command.append(build_target)

        return self._run_subprocess(command, "Cobalt Build", cwd=ninja_cwd)

    def package_app(self):
        # Create the main output directory (e.g., ./dist) if it doesn't exist
        # This is where the .wgt file will be placed.
        if not os.path.exists(self.output_dir):
            print(f"Creating main output directory: {self.output_dir}")
            os.makedirs(self.output_dir, exist_ok=True)

        # The source for packaging is `self.cobalt_app_content_path_for_build`
        # This directory should contain everything needed for the WGT: HTML, JS, CSS, manifest, icons etc.
        # It's populated by the CI step that copies Webpack's `dist/` output.
        if not os.path.isdir(self.cobalt_app_content_path_for_build):
            print(f"Error: Cobalt application content path not found: {self.cobalt_app_content_path_for_build}. Cannot package.")
            return False

        # Check for a manifest file, common for Tizen web apps
        # Cobalt might generate this, or it might be part of the Webpack output.
        expected_manifest_path = os.path.join(self.cobalt_app_content_path_for_build, 'config.xml') # Tizen WGT manifest
        if not os.path.isfile(expected_manifest_path):
             # Some projects might use manifest.json and tizen CLI converts or uses it.
             alt_manifest_path = os.path.join(self.cobalt_app_content_path_for_build, 'manifest.json')
             if not os.path.isfile(alt_manifest_path):
                print(f"Warning: Tizen manifest (config.xml or manifest.json) not found in {self.cobalt_app_content_path_for_build}. Packaging might fail or be incomplete.")
             else:
                print(f"Found manifest.json at {alt_manifest_path}.")
        else:
            print(f"Found config.xml at {expected_manifest_path}.")


        output_wgt_path = os.path.join(self.output_dir, 'tizentube.wgt')

        command = [
            'tizen', 'package',
            '-t', 'wgt',
            '-o', os.path.abspath(output_wgt_path), # tizen CLI prefers absolute path for output
            '--',
            self.cobalt_app_content_path_for_build
        ]
        return self._run_subprocess(command, "Tizen Packaging")

    def deploy_to_device(self, device_ip):
        if not device_ip:
            print("Error: Device IP not provided for deployment.")
            return False

        wgt_file_path = os.path.join(self.output_dir, 'tizentube.wgt')
        if not os.path.isfile(wgt_file_path):
            print(f"Error: WGT file not found at {wgt_file_path}. Cannot deploy.")
            return False

        command = [
            'tizen', 'install',
            '-t', device_ip,
            '-n', os.path.basename(wgt_file_path),
            '--path', os.path.abspath(self.output_dir)
        ]
        return self._run_subprocess(command, "Tizen Deploy")

    def run_tests(self):
        if not self.cobalt_path or not os.path.isdir(self.cobalt_path):
            print(f"Cobalt path '{self.cobalt_path}' is not valid (from config). Skipping tests.")
            return False # Indicate tests were skipped due to config issue

        # Path to test runner can be made configurable in cobalt_config.json
        default_test_script_rel_path = os.path.join('starboard', 'tools', 'testing', 'test_runner.py')
        test_script_path_config = self.config.get('test_runner_script', default_test_script_rel_path)
        test_script_abs_path = os.path.join(self.cobalt_path, test_script_path_config)

        if not os.path.isfile(test_script_abs_path):
            print(f"Cobalt test script not found at '{test_script_abs_path}'. Please check 'cobalt_path' and 'test_runner_script' in config. Skipping tests.")
            return False

        command = [
            'python3',
            test_script_abs_path,
            '--platform', self.platform
        ]
        # Add other test arguments from config if specified
        test_args = self.config.get('test_args', [])
        command.extend(test_args)

        return self._run_subprocess(command, "Cobalt Tests", cwd=self.cobalt_path) # Run tests from cobalt_path

def main():
    print("Starting TizenTube Cobalt Integration Script...")
    integrator = CobaltIntegration() # Constructor now handles critical config checks and exits if needed

    print("\nBuilding Cobalt application...")
    if not integrator.build_cobalt():
        print("Cobalt build failed. Aborting subsequent steps.")
        exit(1)

    print("\nPackaging Tizen WGT application...")
    if not integrator.package_app():
        print("Application packaging failed. Aborting subsequent steps.")
        exit(1)

    print("\nRunning Cobalt tests...")
    if not integrator.run_tests():
        print("Tests failed or were skipped. Continuing with deployment if configured...")
        # Depending on policy, you might want to exit(1) here if tests are mandatory for release
    else:
        print("Cobalt tests passed or were skipped successfully.")

    device_target_ip = integrator.config.get('device_ip', None)
    if device_target_ip:
        print(f"\nAttempting to deploy to device: {device_target_ip}...")
        if integrator.deploy_to_device(device_target_ip):
            print("Deployment to device successful.")
        else:
            print("Deployment to device failed.")
    else:
        print("\nDevice IP not configured in cobalt_config.json (key: 'device_ip'). Skipping deployment.")
        print(f"Packaged application is available at: {os.path.join(integrator.output_dir, 'tizentube.wgt')}")

    print("\nIntegration script finished successfully.")

if __name__ == '__main__':
    main()
