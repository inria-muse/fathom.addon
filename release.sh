#!/bin/bash
cfx xpi --update-link https://muse.inria.fr/fathom/fathom.xpi --update-url https://muse.inria.fr/fathom/fathom.update.rdf
cp -u fathom.xpi ../fathom.web/
cp -u fathom.update.rdf ../fathom.web/
pushd ../fathom.web
git commit -a -m "xpi release update"
git push
popd

