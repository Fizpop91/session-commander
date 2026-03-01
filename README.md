Setup Process

The Setup page prepares all SSH trust required for Session Commander to run direct NAS-to-NAS transfers.

What the app needs

Session Commander uses three systems:

Storage Location: source of backups and templates

Working Location: destination for active sessions, and source for backups back to Storage

Docker container: the web app and orchestrator

The container does not copy files through itself.
Instead, it connects over SSH and tells one NAS to copy directly to the other NAS using scp.

Because of that, SSH trust must exist in multiple directions.

Step 1: Configure Targets

This step stores the connection details for both NAS systems:

host / IP

SSH port

username

root path used over SSH

It also accepts temporary bootstrap passwords for the Storage and Working systems.

These passwords are:

used only during setup actions

kept in memory only

not saved to disk

The saved config is written to data/config.json.

Step 2: Authorize Container Access

This is a one-click setup step that prepares the Docker container to log into both NAS systems.

When you click Authorize Container, the app:

generates an SSH keypair inside the container (if it does not already exist)

installs the container public key into the selected SSH account on the Storage Location

installs the container public key into the selected SSH account on the Working Location

tests SSH connectivity to both systems

checks whether scp and rsync are available on each system

This enables:

container → Storage

container → Working

The container keypair is stored under:

data/ssh/id_ed25519

data/ssh/id_ed25519.pub

Step 3: Enable Direct NAS-to-NAS Trust

The app needs the NAS systems to trust each other so one NAS can push files directly to the other.

This is split into two one-click actions:

Enable Storage → Working

Enable Working → Storage

Enable Storage → Working

This action:

generates an SSH keypair on the Storage Location account (if needed)

installs the Storage Location public key into the Working Location account’s authorized_keys

tests direct SSH from Storage to Working

This enables:

Storage → Working

This is used for restoring sessions or copying templates from storage location to working location.

Enable Working → Storage

This action:

generates an SSH keypair on the Working Location account (if needed)

installs the Working Location public key into the Storage Location account’s authorized_keys

tests direct SSH from Working to Storage

This enables:

Working → Storage

This is used for backing up active sessions from working location back to storage location.

Why this setup is required

Session Commander is designed so file transfers happen directly between the two NAS systems.

That means:

the browser never handles file data

the Docker container does not act as a file relay

the app only coordinates SSH commands

This keeps transfers aligned with the intended architecture and avoids routing session data through the local machine.

Transfer method

For v1, Session Commander uses scp for direct folder copies.

scp was chosen because:

it is already available on the Storage Location

it is sufficient for the intended replace-not-merge workflow

it avoids depending on rsync being installed on the Storage Location

rsync is still detected during setup for information, but it is not required for v1 operation.

Security notes

Bootstrap passwords are temporary and are not stored.

Persistent access is provided through SSH keys.

The container stores only its own SSH keypair and non-sensitive config.

NAS-to-NAS trust is established only between the configured SSH accounts.

For best security, use dedicated service accounts where possible instead of root, unless the NAS platform requires root for SSH access. On some systems, only root may be practical for the initial version.

Result of successful setup

When setup is complete, the following trust relationships exist:

container → Storage

container → Working

Storage → Working

Working → Storage

At that point, the app is ready to browse session folders and perform direct transfers.

Remote deploy helper (for server-based Docker workflow)

If you sync project files from your Mac to a Docker server, run this on the server:

bash scripts/deploy-server.sh

Options:

--no-cache (force full image rebuild)

--no-logs (skip tail output)

--no-down (skip docker compose down; default is to run down first)

--service <name> (override compose service name; default: session-commander)

Example Mac one-liner (sync + deploy):

rsync -az --delete /path/to/session-commander/ user@your-server:/srv/session-commander/ && ssh user@your-server "cd /srv/session-commander && bash scripts/deploy-server.sh"
