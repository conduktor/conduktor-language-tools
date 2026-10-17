## Connect to your Console

**Add Connection** asks for four things:

1. **The Console URL.** For a local stack, `http://localhost:8080`.
2. **A token:** a personal access token created in the Console, or an admin API key. Add Connection checks it with the
   Console before saving anything, so a wrong URL or token stops here.
3. **A name** for the connection. It defaults to the URL's host.
4. **A mode.** Pick **Prod** to start: it never changes the Console. **Dev** can, after a confirmation. You can switch
   later with **Conduktor: Change Mode**.

Once connected, the status bar shows the connection's name, the kind of token (`admin`, `user` or `app`) and the
mode, for example `local · admin · prod`. Click it to switch between connections.

| Token                                | Reaches                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| Admin API key                        | Every resource kind                                            |
| Personal access token                | Every resource kind, as that user, with their permissions      |
| Application-instance token           | The resources that instance owns                               |
| Machine token, browser session token | Refused: machine tokens have no REST audience; sessions expire |

Tokens live in VS Code's secret storage, never in settings, files or logs.
