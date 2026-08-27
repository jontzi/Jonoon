# JONOON

Mobiiliystävällinen web-sovellus M Room -liikkeiden julkisen jonotilanteen seurantaan. Kun jonotusaika ylittää käyttäjän määrittämän matka-ajan tai ajan arvioituun saapumiseen, palvelin lähettää web-push-ilmoituksen puhelimeen myös sivun ollessa suljettuna.

JONOON on epävirallinen itsenäinen projekti, eikä se ole M Roomin kehittämä tai hyväksymä. Sovellus ei varaa aikaa eikä liity jonoon käyttäjän puolesta.

## Toiminnot

- valittavana Suomen M Room -liikkeet ja saatavilla olevat työntekijät
- live-jonotilanne ja aukiolo M Roomin julkisesta palvelusta
- ajoitus joko matka-aikana tai arvioituna saapumiskellonaikana
- selkeä **Liity jonoon** / **Odota vielä** -suositus
- laitekohtainen seuranta ja web-push-ilmoitus
- PWA: sovelluksen voi lisätä puhelimen kotinäyttöön
- pysyvä JSON-tallennus pienelle yhden käyttäjän homelab-asennukselle

## Paikallinen käynnistys

```powershell
npm install
npm start
```

Avaa `http://localhost:3000`. Localhostissa service worker ja ilmoitukset toimivat selaimen turvallisen kontekstin poikkeuksella.

## Docker- ja Kubernetes-asennus

Rakenna image k3s-solmulla tai tuo se k3s:n containerd-rekisteriin:

```bash
docker build -t jono:latest .
docker save jono:latest | sudo k3s ctr images import -
kubectl apply -f k8s.yaml
kubectl rollout status deployment/jono
```

Muokkaa ennen käyttöönottoa tiedostosta `k8s.yaml` ainakin `VAPID_SUBJECT`, Ingress-host, TLS Secret, image-asetukset ja tarvittaessa NodePort. Jos käytät paikallista DNS:ää, osoita valitsemasi host konesolmun tai kuormantasaajan IP-osoitteeseen, esimerkiksi:

```text
jono.home.example -> <server-lan-ip>
```

Suora NodePort-testi:

```text
http://<server-lan-ip>:30003
```

## HTTPS on ilmoituksille pakollinen

Puhelimen web-push ja service worker vaativat turvallisen HTTPS-osoitteen. `k8s.yaml` odottaa Traefik TLS Secret -resurssia nimeltä `jono-tls`.

Secret voidaan tehdä olemassa olevasta, puhelimen luottamasta sertifikaatista:

```bash
kubectl create secret tls jono-tls --cert=jono.crt --key=jono.key
kubectl apply -f k8s.yaml
```

Pelkkä itse allekirjoitettu sertifikaatti ei riitä, ellei sen CA ole asennettu puhelimen luotettuihin varmenteisiin. Vaihtoehtona on julkisesti luotettu sertifikaatti oman verkkotunnuksen tai tunnelin kautta.

## Push-avaimet ja seurannan tila

Ensimmäisellä käynnistyksellä palvelin luo VAPID-avaimet automaattisesti hakemistoon `/app/data`. PVC säilyttää avaimet ja laitetilaukset uudelleenkäynnistyksissä.

Tuotannossa avaimet voi myös antaa ympäristömuuttujina:

```text
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT=mailto:admin@example.com
```

Älä vaihda VAPID-avaimia sen jälkeen, kun puhelin on tilannut ilmoitukset; avainten vaihto edellyttää ilmoitusten tilaamista uudelleen.

## Tailscale

`tailscale-ingress.example.yaml` julkaisee vain JONOON-palvelun Tailscale Kubernetes Operatorin kautta. Tuloksena on tyypillisesti `https://jono.<your-tailnet>.ts.net/`. Esimerkki ei sisällä minkään yksittäisen homelabin osoitteita tai muiden palveluiden asetuksia.

## Seurantalogiikka

Palvelin tarkistaa aktiiviset seurannat oletuksena minuutin välein. Ajoituksen voi määrittää kahdella tavalla:

```text
Matka-aika:     jonotusaika > valittu matka-aika
Saapumisaika:  jonotusaika > minuutit arvioituun saapumiseen
```

Ylöspäin tapahtuvasta rajanylityksestä lähetetään **Nyt jonoon** -ilmoitus. Jos jono tämän jälkeen lyhenee takaisin rajan alle, lähetetään **Jono lyheni** -ilmoitus. Sama tila ei tuota uusia ilmoituksia jokaisella minuutin tarkistuksella.

## Huomio M Room -integraatiosta

Sovellus käyttää samaa julkista liike- ja jonotietoa, jota `my.mroom.com` näyttää. Rajapinta ei ole tämän projektin hallinnassa, joten M Roomin tekemä datamuodon tai osoitteen muutos voi vaatia sovittimen päivittämistä. Sovellus ei automatisoi jonoon liittymistä eikä käsittele M Room -tunnuksia; pääpainike avaa valitun liikkeen virallisen My M Room -sivun.

## Lisenssi

[MIT](LICENSE)
