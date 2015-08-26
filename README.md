# Fathom v2.0

Rewrite of the original Fathom Firefox extension (http://fathom.icsi.berkeley.edu/index.html) on top of the Firefox add-on SDK (aka jetpack).

Homepage: https://muse.inria.fr/fathom

License: MIT

## Extension Development

Fathom v2.0 is written on top of the Firefox Add-on SDK (https://developer.mozilla.org/en/Add-ons/SDK). To develop add-on extensions, you need:

- Firefox (38.0 or later)
- NPM (npm install jpm -g)

To run a firefox with temporary profile and the addon installed:

```
$ cd <path-to>/fathom.git
$ jpm run
```

To run the unit tests:

```
$ jpm test
```

More info on jpm: https://developer.mozilla.org/en-US/Add-ons/SDK/Tools/jpm

## Download and Use Fathom

Fathom comes with a set of built-in tools for network monitoring and troubleshooting. If you are interested in trying them out, read more from [our project web site](https://muse.inria.fr/fathom).

## Use Fathom on Web Pages

Fathom provides a set of network measurement oriented javascript APIs for regular web pages, read more from [our project dev web site](https://muse.inria.fr/fathom/dev).

### Contributors

- Anna-Kaisa Pietilainen <anna-kaisa.pietilainen_AT_inria.fr>
- Stephane Archer <stephane.archer_AT_epita.fr>
- Mohan Dhawan <mohan.dhawan_AT_gmail.com>
- Christian Kreibich <christian_AT_icir.org>
- Renata Teixeira <renata.teixeira_AT_inria.fr>
