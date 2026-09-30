# zSSH gebruiken in Claude

De koppeling bestaat uit een plugin en een zSSH-dienst op je eigen VPS. De
plugin geeft Claude de tools en instructies; de dienst voert de opdrachten uit.
Installatie gebeurt via je bestaande SSH-verbinding. Daarna verbindt Claude via
HTTPS met de dienst. Je SSH-privésleutel blijft bij jou.

Dit is een private koppeling voor één VPS-eigenaar. De gateway voert opdrachten
uit als zijn eigen Linux-gebruiker, op de VPS waarop hij draait. Het is nog geen
SSH-client voor meerdere externe servers. Gebruik daarom een aparte, gewone
Linux-gebruiker met alleen toegang tot de gewenste projectmappen.

## 1. Installeer de dienst op de VPS

Log in via SSH als de zSSH-servicegebruiker. Installeer Node 20+ en volg de
`deploy/bootstrap-vps.sh`-installatie in de hoofd-README. Gebruik een Git-revisie
waarin `claude-auth.mjs` aanwezig is. De installer moet de live canary succesvol
afronden.

## 2. Zorg voor een eigen HTTPS-adres

Laat een domein zoals `zssh.jouwdomein.nl` naar jouw VPS wijzen. Gebruik
`deploy/Caddyfile.example` met dat domein om alle paden naar
`127.0.0.1:8788` te proxyen. Ook de OAuth-paden moeten bereikbaar zijn. Open poort
8788 niet naar het internet.

## 3. Activeer de Claude-aanmelding

Voer op de VPS vanuit de geïnstalleerde bronmap uit:

```sh
node deploy/configure-claude.mjs https://zssh.jouwdomein.nl
```

De helper maakt een willekeurige verbindingscode, bewaart die in het private
bestand `~/.config/zssh/gateway.env` en herstart de dienst. Een bestaande code
blijft behouden. De voorgaande instellingen staan in
`~/.config/zssh/gateway.env.before-claude`.

Bekijk `ZSSH_OWNER_PASSWORD` zelf in je SSH-terminal wanneer je het
aanmeldscherm gebruikt. Deel deze code niet in de chat. De helper schakelt de
aparte lokale OpenAI-tunnelroute uit: een publieke reverse proxy komt namelijk
ook vanaf loopback binnen, en mag daardoor geen toegang zonder token krijgen.

## 4. Maak en upload de plugin

Maak vanuit de bronmap een ZIP met jouw werkelijke endpoint:

```sh
npm run plugin:pack -- --url https://zssh.jouwdomein.nl/mcp
```

Upload `dist/zssh-claude.zip` onder Customize → Plugins in Claude. De ZIP bevat
de pluginmanifest, de HTTP MCP-configuratie en de VPS-skill. Er zitten geen
inloggegevens in. Activeer de zSSH-connector en klik op Connect. Geef op het
aanmeldscherm van **jouw zSSH-domein** de verbindingscode op en keur de toegang
goed.

Als jouw Claude-interface de connector niet vanuit de upload toevoegt, voeg
dezelfde `https://zssh.jouwdomein.nl/mcp`-URL toe onder Customize → Connectors →
Add custom connector. De officiële Claude-aanmeldroute gebruikt deze OAuth-
flow. `authorization_token` uit de Anthropic API is geen instelveld voor de
gewone Claude-webinterface.

Claude Code kan dezelfde plugin gebruiken, of rechtstreeks verbinden:

```sh
claude mcp add --transport http zssh https://zssh.jouwdomein.nl/mcp
```

Open `/mcp` in Claude Code om je aan te melden. Zonder `--url` maakt de
packager een configureerbare versie voor Claude Code die om de endpoint-URL
vraagt; gebruik voor webuploads de versie met een vast ingestelde URL.

## 5. Controleer de verbinding

Vraag Claude: “Gebruik zSSH en toon de hostname, de gebruiker en de uptime van
mijn VPS.” Claude hoort eerst `zssh_server_info` te gebruiken en daarna
`zssh_run_safe` met `uptime`. De hostname en gebruiker moeten overeenkomen met
jouw VPS. Bestandsacties blijven beperkt tot `ZSSH_ALLOWED_ROOTS`.

Volledige shellopdrachten staan standaard uit. Wil je ze voor jouw vertrouwde
VPS gebruiken, stel dan bewust `ZSSH_EXEC_MODE=full` in het gateway-instellingen-
bestand in en herstart de dienst. De toegestane bestandsmappen begrenzen de
shell niet: die heeft alle rechten van de servicegebruiker. Gebruik de
Linux-gebruikersrechten als grens.

## Authenticatie en beperkingen

De OAuth-router van de officiële MCP SDK verzorgt discovery, clientregistratie,
PKCE S256, tokenuitwisseling en intrekking. Toegangstokens verlopen na één uur;
refresh tokens worden bij gebruik vervangen en verlopen na zeven dagen. Codes
zijn kort geldig en eenmalig. Tokens zijn gebonden aan een client en aan jouw
`/mcp`-resource; de eigenaar keurt elke nieuwe verbinding in de browser goed.

OAuth-clients en tokens staan alleen in het geheugen. Na een serviceherstart
zijn alle verbindingen ingetrokken en moet Claude opnieuw verbinden. Dit is
geschikt voor een private pilot; het is geen multi-user beheerplatform.

De tests verifiëren de OAuth-flow en MCP-werking lokaal. Een succesvolle upload
in jouw Claude-account, jouw publieke TLS-route en de werking op jouw echte
VPS moeten afzonderlijk live gecontroleerd worden.

Officiële bronnen:

- [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Claude plugins](https://support.claude.com/en/articles/13837440-use-plugins-in-claude)
- [Claude pluginmanifest](https://code.claude.com/docs/en/plugins-reference)
