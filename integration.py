#!/usr/bin/env python3
import os
import json
import subprocess

class CobaltIntegration:
    def __init__(self):
        self.config = self.load_config()
        self.build_dir = self.config.get('build_dir', 'build')
        # Ensure output_dir from config is used, falling back to 'dist'
        # This 'dist' should match webpack's output.path
        self.output_dir = self.config.get('output_dir', 'dist')
        self.cobalt_path = self.config.get('cobalt_path', None) # Will be validated before use
        self.platform = self.config.get('platform', 'tizen')
        self.build_flags = self.config.get('build_flags', []) # Get build_flags

    def load_config(self):
        try:
            with open('cobalt_config.json', 'r') as f:
                config_data = json.load(f)
                print("Loaded cobalt_config.json successfully.")
                return config_data
        except FileNotFoundError:
            print("Warning: cobalt_config.json not found. Using default configuration.")
            return {
                'build_dir': 'build',
                'output_dir': 'dist',
                'cobalt_path': None, # Default to None, requires user setup
                'platform': 'tizen',
                'build_flags': [] # Default to empty list
            }
        except json.JSONDecodeError as e:
            print(f"Error decoding cobalt_config.json: {e}. Using default configuration.")
            return {
                'build_dir': 'build',
                'output_dir': 'dist',
                'cobalt_path': None,
                'platform': 'tizen',
                'build_flags': []
            }

    def _run_subprocess(self, command_args, operation_name="Subprocess"):
        """Helper to run subprocesses and handle errors."""
        print(f"Running: {' '.join(command_args)}")
        try:
            result = subprocess.run(command_args, check=True, capture_output=True, text=True)
            if result.stdout:
                print(f"{operation_name} STDOUT:\n{result.stdout}")
            if result.stderr: # Ninja often prints to stderr even on success
                print(f"{operation_name} STDERR:\n{result.stderr}")
            print(f"{operation_name} completed successfully.")
            return True
        except subprocess.CalledProcessError as e:
            print(f"{operation_name} failed. Return code: {e.returncode}")
            if e.stdout:
                print(f"STDOUT:\n{e.stdout}")
            if e.stderr:
                print(f"STDERR:\n{e.stderr}")
            # No raise here, main script will decide to continue or not
            return False
        except FileNotFoundError:
            print(f"{operation_name} failed: Command '{command_args[0]}' not found. Ensure it's in your PATH.")
            return False
        except Exception as e:
            print(f"{operation_name} failed with an unexpected error: {e}")
            return False

    def build_cobalt(self):
        if not self.cobalt_path or not os.path.isdir(self.cobalt_path):
            print(f"Error: Cobalt path '{self.cobalt_path}' is not valid or not configured in cobalt_config.json. Cannot build Cobalt.")
            return False

        # Construct the build command including any build_flags
        # Example: ninja -C out/linux-x64x11 cobalt_install --tizen --release
        # The target 'cobalt_install' or similar might be needed instead of just 'cobalt_platform'
        # if the build system generates installable artifacts in a specific step.
        # For now, assuming 'cobalt_{self.platform}' is the correct target.
        build_target = f'cobalt_{self.platform}' # This might need to be more specific like 'cobalt_install'
        command = ['ninja', '-C', os.path.join(self.cobalt_path, self.build_dir)]
        command.extend(self.build_flags) # Add configured build flags
        command.append(build_target)

        return self._run_subprocess(command, "Cobalt Build")

    def package_app(self):
        if not os.path.exists(self.output_dir):
            print(f"Creating output directory: {self.output_dir}")
            os.makedirs(self.output_dir, exist_ok=True)

        # Determine the source of packaged content. This is highly dependent on Cobalt's build output.
        # It's usually a specific directory within cobalt_path/build_dir/platform_out_dir/
        # For example: cobalt/out/tizen_arm_debug/content_shell_content
        # The original f'{self.build_dir}/cobalt' is likely too generic.
        # This path needs to point to the directory containing the Cobalt application
        # bundle (e.g., HTML, JS, CSS, manifest.json for a web app).
        # Let's assume for now it's a 'content' subfolder in the build output.

        # This path needs to be accurate based on where `ninja` puts the build output for packaging
        # e.g., os.path.join(self.cobalt_path, self.build_dir, 'out', self.platform + "_some_config", "app_content_folder")
        # For now, using a placeholder that needs verification:
        cobalt_app_content_path = os.path.join(self.cobalt_path, self.build_dir, "app_to_package")

        if not os.path.isdir(cobalt_app_content_path):
            print(f"Error: Cobalt application content path not found: {cobalt_app_content_path}. Cannot package.")
            print("Please ensure this path points to the directory containing the built Cobalt application (HTML, JS, assets).")
            return False

        output_wgt_path = os.path.join(self.output_dir, 'tizentube.wgt')

        # The Tizen CLI package command usually takes the source directory directly.
        # The '--' is used to separate tizen options from source path if path could be mistaken for an option.
        command = [
            'tizen', 'package',
            '-t', 'wgt', # Type Web Tizen package
            '-o', output_wgt_path, # Output .wgt file path
            '--', # End of tizen options marker
            cobalt_app_content_path # Path to the content to be packaged
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
            '-n', os.path.basename(wgt_file_path), # Name of the package file
            '--path', os.path.abspath(self.output_dir) # Path to the directory containing the .wgt
        ]
        return self._run_subprocess(command, "Tizen Deploy")

    def run_tests(self):
        if not self.cobalt_path or not os.path.isdir(self.cobalt_path):
            print(f"Cobalt path '{self.cobalt_path}' is not valid. Skipping tests.")
            return False

        test_script_path = os.path.join(self.cobalt_path, 'starboard', 'tools', 'testing', 'test_runner.py') # Example path
        # Or, if it's the one from the original example:
        # test_script_path = os.path.join(self.cobalt_path, 'tests', 'run_tests.py')

        if not os.path.isfile(test_script_path):
            print(f"Cobalt test script not found at '{test_script_path}'. Please check 'cobalt_path' in config. Skipping tests.")
            return False

        # Tests might need the build output directory
        # This also depends on the specific test runner.
        # cobalt_build_output = os.path.join(self.cobalt_path, self.build_dir) # Example

        command = [
            'python3',
            test_script_path,
            '--platform', self.platform
            # Add other necessary test arguments like:
            # '--out_dir', cobalt_build_output,
            # '--target_name', 'tests_target_name'
        ]
        return self._run_subprocess(command, "Cobalt Tests")

def main():
    print("Starting TizenTube Cobalt Integration Script...")
    integrator = CobaltIntegration()

    if not integrator.cobalt_path:
        print("Error: 'cobalt_path' is not defined in cobalt_config.json or the file is missing.")
        print("Please create cobalt_config.json with a valid 'cobalt_path' pointing to your Cobalt checkout directory.")
        print("Example cobalt_config.json:")
        print("""
{
  "build_dir": "out/my_tizen_build",
  "output_dir": "dist",
  "cobalt_path": "/path/to/your/cobalt/checkout",
  "platform": "tizen-arm",
  "build_flags": ["-- MyAppSpecificFlag"]
}
""")
        return

    if not integrator.build_cobalt():
        print("Cobalt build failed. Aborting subsequent steps.")
        return

    if not integrator.package_app():
        print("Application packaging failed. Aborting subsequent steps.")
        return

    if not integrator.run_tests():
        print("Tests failed or were skipped.")
        # Decide if failure here should abort deployment
        # For now, we'll proceed to deploy even if tests fail/skipped, but log it.

    # --- Deployment (Optional) ---
    # To enable deployment, configure device_ip in cobalt_config.json or pass as arg
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

    print("\nIntegration script finished.")

if __name__ == '__main__':
    main()
