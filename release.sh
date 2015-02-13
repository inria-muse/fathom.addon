#!/bin/bash
cfx xpi --update-link https://muse.inria.fr/fathom/fathom.xpi --update-url https://muse.inria.fr/fathom/fathom.update.rdf
cp -f fathom.xpi ../fathom.web/
cp -f fathom.update.rdf ../fathom.web/
pushd ../fathom.web
git commit -a -m "xpi release"
git push
popd
git add fathom.xpi
git add fathom.update.rdf
git commit -m "xpi release"
git push
