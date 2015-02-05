#!/bin/bash
cfx xpi --update-link https://muse.inria.fr/fathom/fathom.xpi --update-url https://muse.inria.fr/fathom/fathom.update.rdf
cp fathom.xpi ../fathom.web/
cp fathom.update.rdf ../fathom/web/
pushd ../fathom.web
git commit -a -m "xpi update"
git push
popd

