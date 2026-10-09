# Crystal Depths

Et turbaseret ASCII-roguelike, der spilles i browseren.

## Sådan spiller du

Åbn `index.html` i en browser - der skal ikke installeres noget. Du kan også køre en lille webserver i mappen, fx:

```
npx http-server . -p 8124
```

og gå ind på http://localhost:8124.

Vælg en class (Warrior, Archer, Cleric, Mage, Rogue, Necromancer eller Trickster). Et run går gennem the Blackwater Mire og the Goblin Warrens til the Forgotten Crypt, hvor bosserne venter. Fra krypten fører trapper ned til sideetagerne the Ossuary og the Silk Hive, hvor du kan samle erfaring og udstyr. Målet er at finde Crystal of Ages.

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
