# Fathom v2.0

Rewrite of the original Fathom Firefox extension (http://fathom.icsi.berkeley.edu/index.html) on top of the Firefox add-on SDK (aka jetpack).

Homepage: https://muse.inria.fr/fathom

License: MIT

## Extension Development

Fathom v2.0 is written on top of the Firefox Add-on SDK (https://developer.mozilla.org/en/Add-ons/SDK). To develop add-on extensions, you need:

- Python 2.5, 2.6 or 2.7.
- Firefox.
- The SDK: you can obtain the latest stable version of the SDK from [Mozilla](https://developer.mozilla.org/en-US/Add-ons/SDK/Tutorials/Installation).

Once you have downloaded the SDK:

```
$ tar -xf addon-sdk.tar.gz
$ cd addon-sdk
$ source bin/activate
$ cd <path-to>/fathom.git
$ cfx run
```

To run the unit tests:

```
$ cfx test
```

More info on cfx: https://developer.mozilla.org/en-US/Add-ons/SDK/Tools/cfx

## Download and Use Fathom

Fathom comes with a set of built-in tools for network monitoring and troubleshooting. If you are interested in trying them out, read more from [our project web site](https://muse.inria.fr/fathom).

## Use Fathom on Web Pages

Fathom provides a set of network measurement oriented javascript APIs for regular web pages. TODO: add some examples here or on the web site.

### Contributors

- Anna-Kaisa Pietilainen <anna-kaisa.pietilainen_AT_inria.fr>
- Stephane Archer <stephane.archer_AT_epita.fr>
- Mohan Dhawan <mohan.dhawan_AT_gmail.com>
- Christian Kreibich <christian_AT_icir.org>
- Renata Teixeira <renata.teixeira_AT_inria.fr>
