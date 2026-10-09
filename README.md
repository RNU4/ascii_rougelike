# Crystal Depths

Et ASCII-roguelike i browseren. Kæmp dig gennem den glemte krypt, besejr dens bosser og gør krav på Krystallen af Evigheder.

## Sådan spiller du

Åbn `index.html` i en browser - der skal ikke installeres noget. Du kan også køre en lille webserver i mappen, fx:

```
npx http-server . -p 8124
```

og gå ind på http://localhost:8124.

Vælg en klasse (Warrior, Archer, Cleric, Mage, Rogue, Necromancer eller Trickster) og begiv dig ned i krypten. Sideetager som the Ossuary, the Goblin Warrens og the Silk Hive giver erfaring og udstyr, før du tager imod bosserne.

## Taster

| Tast | Handling |
|---|---|
| Piletaster / WASD / QEZC / numpad | Bevæg dig (gå ind i fjender for at angribe) |
| 1-5 | Brug færdigheder |
| Mellemrum | Vent en tur |
| K | Færdigheder (byt rundt på dem) |
| I | Inventar |
| G | Saml op |
| R | Drik en helbredende eliksir |
| T | Taktik for dine ledsagere |
| P | Dit hold |
| O | Indstillinger |
| Esc | Annullér |

Under Indstillinger kan du slå debug-tilstand til (M: vis kortet, N: spøgelsestilstand, J: hop til en vilkårlig etage).

## Teknik

Ren JavaScript uden build-trin eller afhængigheder - bare `<script>`-tags i `index.html`.
