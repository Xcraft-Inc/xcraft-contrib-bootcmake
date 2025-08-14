# 📘 xcraft-contrib-bootcmake

## Aperçu

Le module `xcraft-contrib-bootcmake` est un utilitaire spécialisé du framework Xcraft qui automatise le téléchargement, la compilation et l'installation de CMake depuis les sources. Il fournit une solution cross-platform pour intégrer CMake dans l'écosystème Xcraft, en gérant automatiquement les spécificités de chaque système d'exploitation (Windows avec MinGW, Unix/Linux).

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est organisé autour d'un fichier principal `cmake.js` qui expose une commande `build` sur le bus Xcraft. Il utilise plusieurs modules utilitaires de l'écosystème Xcraft pour gérer le téléchargement, l'extraction, la compilation et l'installation de CMake.

**Composants principaux :**

- **Gestionnaire de build** : Orchestration complète du processus de compilation
- **Adaptateurs cross-platform** : Gestion des spécificités Windows/Unix
- **Système de patches** : Application automatique de correctifs si nécessaire
- **Configuration dynamique** : Paramétrage via `xcraft-core-etc`

## Fonctionnement global

Le module suit un pipeline de build en plusieurs étapes orchestrées par `async.auto` :

1. **Téléchargement** (`taskHttp`) : Récupération de l'archive CMake depuis l'URL configurée avec suivi de progression
2. **Extraction** (`taskExtract`) : Décompression de l'archive tar.gz avec suivi de progression
3. **Application de patches** (`taskPatch`) : Application automatique des correctifs spécifiques à l'OS depuis le dossier `patch/`
4. **Préparation** (`taskPrepare`) : Détection de l'environnement et choix de la méthode de build
5. **Gestion MSYS** (`taskMSYS`) : Sur Windows, suppression temporaire des chemins MSYS pour éviter les conflits
6. **Bootstrap/CMake** (`taskBootstrap`/`taskCMake`) : Compilation selon la méthode disponible
7. **Make** (`taskMake`) : Construction et installation finale avec compilation parallèle

Le module s'adapte automatiquement à l'environnement :

- **Windows** : Utilise MinGW Makefiles, gère les conflits avec MSYS, et configure l'environnement MINGW64
- **Unix/Linux** : Utilise Unix Makefiles standard
- **Optimisations** : Applique des flags de compilation optimisés selon l'architecture (`-march=native` sauf pour ARM)

## Exemples d'utilisation

### Construction de CMake via le bus Xcraft

```javascript
// Déclenchement de la construction de CMake
this.quest.cmd('cmake.build', {id: 'unique-build-id'});

// Écoute de la fin de construction
resp.events.subscribe('cmake.build.unique-build-id.finished', (msg) => {
  console.log('CMake build completed');
});
```

### Utilisation des utilitaires cross-platform

```javascript
const cmake = require('xcraft-contrib-bootcmake');

// Obtenir le générateur approprié pour l'OS
const generator = cmake.getGenerator();
// Windows: "MinGW Makefiles"
// Unix: "Unix Makefiles"

// Obtenir l'outil make approprié
const makeTool = cmake.getMakeTool();
// Windows: "mingw32-make"
// Unix: "make"

// Nettoyer le PATH sur Windows (retirer MSYS)
const removedPaths = cmake.stripShForMinGW();
// Retourne la liste des chemins supprimés pour restauration ultérieure
```

## Interactions avec d'autres modules

Le module s'intègre étroitement avec l'écosystème Xcraft :

- **[xcraft-core-etc]** : Gestion de la configuration (version CMake, URLs, répertoires)
- **[xcraft-core-http]** : Téléchargement des archives sources avec suivi de progression
- **[xcraft-core-extract]** : Extraction des archives tar.gz avec suivi de progression
- **[xcraft-core-process]** : Exécution des processus de compilation avec parser cmake
- **[xcraft-core-platform]** : Détection et adaptation cross-platform
- **[xcraft-core-env]** : Gestion des variables d'environnement, du PATH et des devroot
- **[xcraft-core-fs]** : Opérations sur le système de fichiers (création de répertoires, listage)
- **[xcraft-core-devel]** : Application des patches de développement

## Configuration avancée

| Option    | Description                   | Type   | Valeur par défaut                                          |
| --------- | ----------------------------- | ------ | ---------------------------------------------------------- |
| `name`    | Nom du package CMake          | string | `"cmake"`                                                  |
| `version` | Version de CMake à compiler   | string | `"3.27.7"`                                                 |
| `src`     | URI source de l'archive CMake | string | `"http://www.cmake.org/files/v3.27/cmake-3.27.7.tar.gz"` |
| `out`     | Répertoire d'installation     | string | `"./usr"`                                                  |

## Détails des sources

### `cmake.js`

Le fichier principal expose les fonctionnalités de build et les utilitaires cross-platform.

#### Fonctions utilitaires publiques

- **`getGenerator()`** — Retourne le générateur CMake approprié selon l'OS (MinGW Makefiles pour Windows, Unix Makefiles pour les autres).

- **`getMakeTool()`** — Retourne l'outil make approprié selon l'OS (mingw32-make pour Windows, make pour les autres).

- **`stripShForMinGW()`** — Sur Windows, supprime temporairement les chemins MSYS du PATH pour éviter les conflits avec MinGW. Retourne un tableau d'objets contenant l'index et la localisation des chemins supprimés pour restauration ultérieure.

#### Commandes Xcraft

- **`build(msg, resp)`** — Lance le processus complet de téléchargement, compilation et installation de CMake. Gère automatiquement toutes les étapes du pipeline de build avec gestion d'erreurs et restauration du PATH. Émet l'événement `cmake.build.${msg.id}.finished` à la fin du processus.

#### Fonctions internes de build

Le module utilise plusieurs fonctions internes pour orchestrer le build :

- **`bootstrapRun(cmakeDir, resp, callback)`** : Exécute le script bootstrap de CMake avec les paramètres optimisés. Configure automatiquement le préfixe d'installation, la compilation parallèle, et désactive les composants non nécessaires (CursesDialog, OpenSSL). Sur Windows, utilise `sh.exe` avec l'environnement MINGW64.

- **`cmakeRun(srcDir, resp, callback)`** : Alternative utilisant CMake pour se compiler lui-même. Crée un répertoire de build séparé (`BUILD_CMAKE`) et configure les options de compilation optimisées avec le générateur approprié.

- **`makeRun(makeDir, make, resp, callback)`** : Exécution finale de make avec compilation parallèle. Exécute séquentiellement les cibles 'all' et 'install' avec gestion des devroot et utilisation du nombre optimal de jobs parallèles.

- **`patchRun(srcDir, resp, callback)`** : Application automatique des patches spécifiques à l'OS depuis le dossier `patch/`. Recherche les fichiers correspondant au pattern `^([0-9]+|{os}-).*.patch$` et les applique dans l'ordre avec `xcraft-core-devel`.

- **`getCFLAGS()`** : Génération des flags de compilation optimisés selon l'architecture. Utilise `-march=native` sauf pour les architectures ARM, avec optimisation `-O2 -g0 -mtune=native`.

- **`getJobs()`** : Détermine le nombre de jobs parallèles basé sur le nombre de CPU disponibles via `os.cpus().length`.

Le processus de build utilise des optimisations avancées :

- Compilation parallèle basée sur le nombre de CPU disponibles
- Flags d'optimisation adaptés à l'architecture (native tuning)
- Gestion spéciale pour les architectures ARM
- Configuration Release avec optimisations maximales (`-O2 -g0`)
- Gestion automatique des devroot pour l'environnement bootstrap
- Restauration automatique du PATH Windows après suppression des chemins MSYS

[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-http]: https://github.com/Xcraft-Inc/xcraft-core-http
[xcraft-core-extract]: https://github.com/Xcraft-Inc/xcraft-core-extract
[xcraft-core-process]: https://github.com/Xcraft-Inc/xcraft-core-process
[xcraft-core-platform]: https://github.com/Xcraft-Inc/xcraft-core-platform
[xcraft-core-env]: https://github.com/Xcraft-Inc/xcraft-core-env
[xcraft-core-fs]: https://github.com/Xcraft-Inc/xcraft-core-fs
[xcraft-core-devel]: https://github.com/Xcraft-Inc/xcraft-core-devel

---

_Documentation mise à jour automatiquement pour le module xcraft-contrib-bootcmake_