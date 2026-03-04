## Setup Process

The Setup page prepares all `SSH` trust required for **Session Commander** to run direct location-to-location transfers, as well as container-to-location browsing.

---

### App Requirements

**Session Commander** uses three systems:

- **Storage Location**: Source of session backups and templates.
- **Working Location**: Location where sessions are run from. This can be a network share or a folder on your local machine.
- **Docker container**: the web app and orchestrator

The container does not copy files through itself.
Instead, it connects over `SSH` and tells one location to copy directly to the other location using `rsync` or `scp` as a backup. Because of that, `SSH` trust must exist in multiple directions.

![header](../screenshots/configuration-header.png)

**Step 1: Configure Targets**

![header](../screenshots/configuration-targets.png)

This step stores the connection details for both locations:

- host / IP
- SSH port
- username
- root path used over `SSH`

It also accepts temporary bootstrap passwords for the locations.

These passwords are:

- Used only during setup actions
- Kept only in memory and is removed upon refresh

The saved config is written to data/config.json.
<br>
<br>
<br>
**Step 2: Authorize Container Access**

![header](../screenshots/configuration-auth-done.png)

This is a one-click setup step that prepares the Docker container to log into both locations.

When you click **"Authorize Container"**, the app:

- Generates an `SSH` keypair inside the container (if it does not already exist)
- Installs the container public key into the selected SSH account on the Storage Location and Working Location
- Tests `SSH` connectivity to both systems
- Checks whether `rsync` and `scp` are available on each system

This enables:

container → Storage
<br>
container → Working

The container keypair is stored under:

`data/ssh/id_ed25519`
<br>
`data/ssh/id_ed25519.pub`

Container key comment (for identification/cleanup):

`session-commander-container`
<br>
<br>
<br>
**Step 3: Enable Direct location-to-location Trust**

![header](../screenshots/configuration-trust-done.png)

The app needs the locations to trust each other so one location can push files directly to the other.

This is split into two one-click actions:

**3.1. Enable Storage → Working**

This action:

- Generates an `SSH` keypair on the Storage Location account (if needed)
- Installs the Storage Location public key into the Working Location account’s authorized_keys
- Tests direct `SSH` from Storage → Working

This is used for restoring sessions or copying templates from storage location → working location.
<br>
<br>
**3.2. Enable Working → Storage**

This action:

- Generates an `SSH` keypair on the Working Location account (if needed)
- Installs the Working Location public key into the Storage Location account’s authorized_keys
- Tests direct `SSH` from Working → Storage

This is used for backing up active sessions from working location → storage location.
<br>
<br>
Peer key location on each remote system:

`~/.ssh/ptsh_peer_ed25519`
`~/.ssh/ptsh_peer_ed25519.pub`

Peer key comment (for identification/cleanup):

`session-commander-peer`
<br>
<br>
**Why this setup is required**

**Session Commander** is designed so file transfers happen directly between the two locations, and not via your working machine. This doesn't matter if you run sessions locally on your working machine.

That means:

- The browser never handles file data
- The Docker container does not act as a file relay
- The app only coordinates `SSH` commands

This keeps transfers aligned with the intended architecture and avoids routing session data through the local machine.
<br>
<br>

---
### Transfer Method

**Session Commander** uses `scp` for direct folder copies.

Generally, `scp` is installed by default on most systems, so this avoids depending on `rsync` being installed.

`rsync` is still detected during setup for information, but it is not required for operation yet.

<br>

---
### Security Notes
<br>

- Bootstrap passwords are temporary and are not stored
- Persistent access is provided through `SSH` keys
- The container stores only its own `SSH` keypair and non-sensitive config
- Location-to-location trust is established only between the configured `SSH` accounts

<br>

**Clear Config + Clear SSH Keys Behavior**

The app clears keys in two groups:

container → locations:

- Removes `/app/data/ssh/id_ed25519` and `/app/data/ssh/id_ed25519.pub in the container
- Removes authorized_keys entries matching the current container public key
- Removes authorized_keys entries with `session-commander-container` marker

location → location:

- Removes `~/.ssh/ptsh_peer_ed25519` and `~/.ssh/ptsh_peer_ed25519.pub` on both configured systems
- Removes authorized_keys entries matching the current peer public keys
- Removes authorized_keys entries with `session-commander-peer` marker

<br>

**Important:**

For best security, use dedicated service accounts where possible instead of `root`, unless the platform requires `root` for `SSH` access. On some systems, only `root` may be practical for the initial version.


---
### Result of Successful Setup

When setup is complete, the following trust relationships exist:

container → Storage
<br>
container → Working
<br>
Storage → Working
<br>
Working → Storage

At that point, the app is ready to browse folders and perform direct transfers.
