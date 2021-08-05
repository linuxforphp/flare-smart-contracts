#!/bin/bash

echo $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME
if [ "$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME" != "126-gas-reporting-major-functions" ] ; then
    changedFiles=$(git diff-tree --no-commit-id --name-only -r origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME -r $CI_COMMIT_SHA 2>&1);
    echo $changedFiles
    changedFilesArr=($(echo "$changedFiles" | tr ' ' '\n'))

    for file in "${changedFilesArr[@]}"
    do
        if [ "$file" == "gas-report.json" ] ; then
            echo "Error: Job failed due to changes in gas-report.json" 1>&2
            exit 1
        fi
    done
fi
