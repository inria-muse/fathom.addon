#!/bin/bash
REL=$1
if [ -z "$REL" ]; then
    echo "Usage: web-release.sh <VERSION>"
    exit 1
fi

TAG=v$REL
echo "publish release " $TAG " ..."

cp -f dist/fathom-$REL.xpi ../fathom.web/fathom.xpi

RDF=fathom.update.rdf
cp -f $RDF ../fathom.web/

pushd ../fathom.web
git commit -a -m "xpi release "$TAG
git push
popd

echo "updating server $SSHSTR ..."
ssh $SSHSTR 'cd /home/web/fathom.web; git pull;'

echo 'ready'
